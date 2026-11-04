// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

const SHELL_CACHE = "caimack-shell-v1";
const ASSET_CACHE = "caimack-assets-v2";
const IMAGE_CACHE = "caimack-images-v1";
const HLS_CACHE = "caimack-hls-v2";
const DATA_CACHE = "caimack-data-v2";
const LEGACY_AUDIO_CACHE = "caimack-audio-v1";

const CACHE_DATABASE = "caimack-stream-cache";
const CACHE_STORE = "entries";
const CACHE_DATABASE_VERSION = 1;
const CACHE_BUDGET = 250 * 1024 * 1024;

const IMAGE_ENTRY_BUDGET = 600;

const OWN_CACHES = [SHELL_CACHE, ASSET_CACHE, IMAGE_CACHE, HLS_CACHE, DATA_CACHE];
const DEV = self.location.search === "?dev";

const IMAGE = /^\/api\/(albums|artists|playlists|tracks)\/[0-9a-f-]+\/(cover|image)$/i;
const HLS = /^\/api\/tracks\/([0-9a-f-]+)\/hls\//i;

const UNCACHEABLE_API =
  /^\/api\/(auth|me|connect|tracks\/[^/]+\/stream|playback\/|library\/(scan|enrichment)|integrations\/yandex-music\/imports)/i;

let maintenance = Promise.resolve();

let totalBytes = null;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("caimack-") && !OWN_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );

      await caches.delete(LEGACY_AUDIO_CACHE);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "clear-stream-cache") {
    totalBytes = null;
    event.waitUntil(
      Promise.all([
        caches.delete(SHELL_CACHE),
        caches.delete(HLS_CACHE),
        caches.delete(DATA_CACHE),
        caches.delete(IMAGE_CACHE),
        deleteDatabase(CACHE_DATABASE),
        deleteDatabase("caimack-event-outbox-v1"),
      ]),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const hlsMatch = HLS.exec(url.pathname);
  if (hlsMatch) {
    const trackId = hlsMatch[1];
    event.respondWith(
      url.pathname.endsWith(".m3u8")
        ? playlist(event, request, trackId)
        : segment(event, request, trackId),
    );
    return;
  }

  if (IMAGE.test(url.pathname)) {
    event.respondWith(cacheFirst(event, request, IMAGE_CACHE));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (!UNCACHEABLE_API.test(url.pathname)) event.respondWith(data(event, request));
    return;
  }

  if (DEV && url.pathname.startsWith("/_next/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(event, request, ASSET_CACHE));
    return;
  }

  if (request.mode === "navigate") event.respondWith(shell(event, request));
});

async function playlist(event, request, trackId) {
  const cache = await caches.open(HLS_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });

  const revalidate = fetch(request)
    .then(async (response) => {
      if (response.ok && response.status !== 202) {
        await store(cache, request, response.clone(), trackId);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(Promise.all([revalidate, touch(request.url)]));
    return cached;
  }

  return (await revalidate) ?? Response.error();
}

async function segment(event, request, trackId) {
  const cache = await caches.open(HLS_CACHE);
  const range = request.headers.get("Range");
  const key = new URL(request.url);
  if (range) key.searchParams.set("range", range);

  const cached = await cache.match(key.href, { ignoreVary: true });
  if (cached) {
    event.waitUntil(touch(key.href));
    return range ? new Response(cached.body, { status: 206, headers: cached.headers }) : cached;
  }

  const response = await fetch(request);
  if (response.status === (range ? 206 : 200)) {
    const copy = response.clone();
    event.waitUntil(
      copy
        .arrayBuffer()
        .then((body) =>
          store(
            cache,
            new Request(key.href),
            new Response(body, { headers: copy.headers }),
            trackId,
          ),
        ),
    );
  }
  return response;
}

async function store(cache, request, response, trackId) {
  const measured = response.clone();
  const fromHeader = Number(measured.headers.get("Content-Length") ?? 0);
  const bytes = fromHeader > 0 ? fromHeader : (await measured.arrayBuffer()).byteLength;
  // Serialize replacement accounting with eviction, including concurrent segment writes.
  const save = async () => {
    const previous = await getEntry(request.url);
    const total = await knownTotal();
    await cache.put(request, response);
    await putEntry({ url: request.url, trackId, bytes, touchedAt: Date.now() });
    totalBytes = total - (previous?.bytes ?? 0) + bytes;
    await enforceBudget();
  };
  const saved = maintenance.then(save, save);
  maintenance = saved.catch(() => {
    totalBytes = null;
  });
  await saved;
}

async function knownTotal() {
  if (totalBytes === null) {
    const entries = await allEntries();
    totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  }
  return totalBytes;
}

async function enforceBudget() {
  if ((await knownTotal()) <= CACHE_BUDGET) return;
  totalBytes = await evict();
}

async function evict() {
  const entries = await allEntries();
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (total <= CACHE_BUDGET) return total;

  const cache = await caches.open(HLS_CACHE);
  const groups = new Map();

  for (const entry of entries) {
    const group = groups.get(entry.trackId) ?? { touchedAt: 0, entries: [] };
    group.touchedAt = Math.max(group.touchedAt, entry.touchedAt);
    group.entries.push(entry);
    groups.set(entry.trackId, group);
  }

  const oldestFirst = [...groups.values()].sort((left, right) => left.touchedAt - right.touchedAt);

  for (const group of oldestFirst) {
    for (const entry of group.entries) {
      await cache.delete(entry.url, { ignoreVary: true });
      await deleteEntry(entry.url);
      total -= entry.bytes;
    }
    if (total <= CACHE_BUDGET) return total;
  }

  return total;
}

async function data(event, request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) event.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch {
    return (await cache.match(request, { ignoreVary: true })) ?? Response.error();
  }
}

async function cacheFirst(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    if (cacheName === IMAGE_CACHE) event.waitUntil(trimEntries(cache, IMAGE_ENTRY_BUDGET));
  }
  return response;
}

async function shell(event, request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) event.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch {
    return (
      (await cache.match(request, { ignoreVary: true })) ??
      (await cache.match("/", { ignoreVary: true })) ??
      Response.error()
    );
  }
}

async function trimEntries(cache, budget) {
  const keys = await cache.keys();
  if (keys.length <= budget) return;

  for (const key of keys.slice(0, keys.length - budget)) {
    await cache.delete(key);
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DATABASE, CACHE_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(CACHE_STORE)) {
        request.result.createObjectStore(CACHE_STORE, { keyPath: "url" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(CACHE_STORE, mode);
    const request = action(transaction.objectStore(CACHE_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}

function putEntry(entry) {
  return withStore("readwrite", (store) => store.put(entry));
}

function getEntry(url) {
  return withStore("readonly", (store) => store.get(url));
}

function deleteEntry(url) {
  return withStore("readwrite", (store) => store.delete(url));
}

function allEntries() {
  return withStore("readonly", (store) => store.getAll());
}

async function touch(url) {
  const entry = await withStore("readonly", (store) => store.get(url));
  if (entry) await putEntry({ ...entry, touchedAt: Date.now() });
}

function deleteDatabase(name) {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

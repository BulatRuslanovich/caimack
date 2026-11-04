// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

let shellCachePromise: Promise<void> | null = null;

export async function clearStreamCache(): Promise<void> {
  shellCachePromise = null;
  if ("caches" in window) {
    await Promise.all([
      caches.delete("caimack-shell-v1"),
      caches.delete("caimack-hls-v1"),
      caches.delete("caimack-data-v1"),
      caches.delete("caimack-images-v1"),
    ]);
  }
  if ("indexedDB" in window) {
    await Promise.all([
      deleteBrowserDatabase("caimack-stream-cache"),
      deleteBrowserDatabase("caimack-event-outbox-v1"),
    ]);
  }
  postToStreamWorker({ type: "clear-stream-cache" });
}

export function cacheAppShell(): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window) || !("serviceWorker" in navigator)) {
    return Promise.resolve();
  }

  shellCachePromise ??= (async () => {
    registerStreamWorker();
    await navigator.serviceWorker.ready;

    const request = new Request("/", {
      credentials: "include",
      headers: { Accept: "text/html" },
    });
    const response = await fetch(request);
    if (!response.ok || !response.headers.get("Content-Type")?.includes("text/html")) return;

    const cache = await caches.open("caimack-shell-v1");
    await cache.put(request, response);
  })().catch(() => {
    shellCachePromise = null;
  });

  return shellCachePromise;
}

function postToStreamWorker(message: unknown): void {
  if (!("serviceWorker" in navigator)) return;
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(message);
    return;
  }

  void navigator.serviceWorker.ready.then((registration) =>
    registration.active?.postMessage(message),
  );
}

function deleteBrowserDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

const STREAM_WORKER_URL = process.env.NODE_ENV === "production" ? "/sw.js" : "/sw.js?dev";

export function registerStreamWorker(): void {
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register(STREAM_WORKER_URL, { scope: "/" }).catch(() => {});
  }
}

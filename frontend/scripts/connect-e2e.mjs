// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

// Browser integration checks for the real React player. The deterministic API
// fixture complements the Rust tests of the production HTTP/SSE protocol.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const artifacts = await mkdtemp(join(tmpdir(), "caimack-connect-"));
const browserPath =
  process.env.CAIMACK_TEST_BROWSER ||
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].find(existsSync);
assert(browserPath, "Set CAIMACK_TEST_BROWSER to a Chromium browser executable");
const user = { id: randomUUID(), username: "connect-test", isAdmin: false };
const albumId = randomUUID();
const artistId = randomUUID();
const playlistId = randomUUID();
const tracks = ["First tone", "Second tone", "Third tone"].map((title) => ({
  id: randomUUID(),
  title,
  artistId,
  artistName: "Connect test",
  albumId,
  albumTitle: "Test album",
  durationSeconds: 240,
  originalFileName: "silence.wav",
  isFavorite: false,
  hasCover: false,
  hasLyrics: false,
  createdAt: new Date().toISOString(),
  codec: "wav",
}));
const album = {
  id: albumId,
  title: "Test album",
  artistId,
  artistName: "Connect test",
  trackCount: 3,
  durationSeconds: 720,
  hasCover: false,
  createdAt: new Date().toISOString(),
};
const playlist = {
  id: playlistId,
  name: "Test playlist",
  isPublic: false,
  ownerId: user.id,
  ownerName: user.username,
  trackCount: 3,
  durationSeconds: 720,
  hasCover: false,
  coverTrackId: tracks[0].id,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const audio = Buffer.alloc(44 + 8000 * 2 * 240);
audio.write("RIFF");
audio.writeUInt32LE(audio.length - 8, 4);
audio.write("WAVEfmt ", 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24);
audio.writeUInt32LE(16000, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write("data", 36);
audio.writeUInt32LE(audio.length - 44, 40);
let version = 0;
const epoch = randomUUID();
let playback = null;
let holder = null;
const devices = new Map();
const pending = new Map();
const commands = [];
const errors = [];
const requests = new Map();
const snapshot = () => ({
  epoch,
  version,
  devices: [...devices.values()].map((device) => ({
    id: device.id,
    name: device.name,
    connectionId: device.connectionId,
    kind: "web",
  })),
  playback,
});
const event = (response, kind, data) => {
  if (!response.writableEnded && !response.destroyed)
    response.write(`event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`);
};
const broadcast = () => {
  version++;
  for (const device of devices.values()) event(device.response, "snapshot", snapshot());
};
const json = (response, body, status = 200) => {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
};
const problem = (response) =>
  json(response, { detail: "Playback fixture rejected a stale request" }, 409);

const backend = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const path = url.pathname;
    requests.set(`${request.method} ${path}`, (requests.get(`${request.method} ${path}`) || 0) + 1);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : {};
    if (path === "/api/playback/connect/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders();
      const id = url.searchParams.get("deviceId");
      const device = {
        id,
        name: `Test output ${devices.size + 1}`,
        connectionId: randomUUID(),
        response,
      };
      devices.set(id, device);
      broadcast();
      response.on("close", () => {
        if (devices.get(id) === device) {
          devices.delete(id);
          broadcast();
        }
      });
      return;
    }
    if (path === "/api/playback/session") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders();
      const id = url.searchParams.get("deviceId");
      if (holder && holder.id !== id)
        event(holder.response, "displaced", { deviceId: id, deviceName: "Test output" });
      const claim = { id, response };
      holder = claim;
      event(response, "claimed", id);
      response.on("close", () => {
        if (holder === claim) holder = null;
      });
      return;
    }
    if (path === "/api/playback/connect/heartbeat") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (path === "/api/playback/connect/state") {
      if (
        devices.get(body.deviceId)?.connectionId !== body.connectionId ||
        (holder && holder.id !== body.deviceId)
      )
        return problem(response);
      const changed =
        playback?.deviceId !== body.deviceId ||
        JSON.stringify(playback.trackIds) !== JSON.stringify(body.state.trackIds) ||
        JSON.stringify(playback.order) !== JSON.stringify(body.state.order);
      playback = {
        ...body.state,
        deviceId: body.deviceId,
        queueRevision: (playback?.queueRevision ?? 0) + Number(changed),
        reportedAt: new Date().toISOString(),
      };
      broadcast();
      return json(response, snapshot());
    }
    if (path === "/api/playback/connect/commands") {
      const target = devices.get(body.deviceId);
      if (!target || (body.queueRevision != null && body.queueRevision !== playback?.queueRevision))
        return problem(response);
      commands.push(body.command);
      pending.set(body.id, response);
      event(target.response, "command", {
        id: body.id,
        connectionId: target.connectionId,
        expiresAt: new Date(Date.now() + 10000).toISOString(),
        queueRevision: body.queueRevision ?? null,
        command: body.command,
      });
      return;
    }
    if (path.endsWith("/ack")) {
      const id = path.split("/").at(-2);
      const waiting = pending.get(id);
      pending.delete(id);
      if (waiting) {
        if (body.error) problem(waiting);
        else json(waiting, snapshot());
      }
      response.writeHead(204);
      response.end();
      return;
    }
    if (path === "/api/auth/me" || path === "/api/auth/login") return json(response, user);
    if (path === "/api/config")
      return json(response, {
        maxUploadBytes: 10000000,
        maxImageUploadBytes: 1000000,
        accessTokenMinutes: 60,
        recommendationsEnabled: false,
      });
    if (path === "/api/me/settings")
      return json(response, { quality: "Original", timeZone: "UTC" });
    if (path === "/api/home/feed") return json(response, { blocks: [] });
    if (path === "/api/library/overview")
      return json(response, {
        stats: {
          trackCount: 3,
          albumCount: 0,
          favoriteCount: 0,
          totalDurationSeconds: 720,
          totalBytes: 0,
          freeBytes: 0,
        },
        recentTracks: tracks,
        recentAlbums: [],
        recentArtists: [],
        topGenres: [],
      });
    if (path === "/api/tracks")
      return json(response, { items: tracks, total: 3, page: 1, pageSize: 50, totalPages: 1 });
    if (path === `/api/albums/${albumId}`) return json(response, { ...album, tracks });
    if (path === "/api/albums")
      return json(response, { items: [album], total: 1, page: 1, pageSize: 50, totalPages: 1 });
    if (path === `/api/playlists/${playlistId}`) return json(response, { ...playlist, tracks });
    if (path === "/api/playlists") return json(response, [playlist]);
    if (path === "/api/tracks/lookup")
      return json(
        response,
        tracks.filter((track) => body.ids.includes(track.id)),
      );
    if (path.endsWith("/waveform")) return json(response, { peaks: [] });
    if (path.endsWith("/lyrics")) {
      response.writeHead(204);
      response.end();
      return;
    }
    if (path.endsWith("/hls/master.m3u8"))
      return json(response, { detail: "No adaptive rendition in this fixture" }, 404);
    if (path.endsWith("/stream")) {
      const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range || "");
      const from = range ? Number(range[1]) : 0;
      const to = range?.[2] ? Number(range[2]) : audio.length - 1;
      response.writeHead(range ? 206 : 200, {
        "Content-Type": "audio/wav",
        "Accept-Ranges": "bytes",
        "Content-Length": to - from + 1,
        ...(range ? { "Content-Range": `bytes ${from}-${to}/${audio.length}` } : {}),
      });
      response.end(audio.subarray(from, to + 1));
      return;
    }
    if (path === "/api/history" || path === "/api/playback/signals") {
      response.writeHead(204);
      response.end();
      return;
    }
    return json(response, []);
  } catch (error) {
    errors.push(String(error));
    if (!response.headersSent) json(response, {}, 500);
    else response.end();
  }
});
await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
const backendUrl = `http://127.0.0.1:${backend.address().port}`;
const frontendPort = Number(process.env.CAIMACK_TEST_PORT || 3197);
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
let serverLog = "";
const next = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(frontendPort),
  ],
  {
    cwd: root,
    env: { ...process.env, BACKEND_INTERNAL_URL: backendUrl },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
for (const pipe of [next.stdout, next.stderr])
  pipe.on("data", (data) => {
    serverLog = (serverLog + data).slice(-30000);
  });
let browserLog = "";
const browser = spawn(
  browserPath,
  [
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-features=HardwareMediaKeyHandling",
    "--password-store=basic",
    "--mute-audio",
    "--disable-background-media-suspend",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--autoplay-policy=no-user-gesture-required",
    "--remote-debugging-port=0",
    `--user-data-dir=${join(artifacts, "browser")}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
);
browser.stderr.on("data", (data) => {
  browserLog = (browserLog + data).slice(-15000);
});

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.id = 0;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.id) {
        const promise = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) promise?.reject(new Error(JSON.stringify(data.error)));
        else promise?.resolve(data.result);
      }
      if (data.method === "Runtime.exceptionThrown")
        errors.push(
          data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text,
        );
    });
  }
  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve);
      socket.addEventListener("error", reject);
    });
    return new Cdp(socket);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timed out: ${method}`));
      }, 20000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text,
      );
    return result.result.value;
  }
  close() {
    this.socket.close();
  }
}
const sessions = [];
const until = async (check, description, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(200);
  }
  throw new Error(`Timed out: ${description}`);
};
const click = (page, label) =>
  page.eval(
    `(() => { const b = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!b) throw Error('Missing button: ' + ${JSON.stringify(label)}); b.click(); })()`,
  );
const text = (page) => page.eval("document.querySelector('footer.player-shell')?.innerText || ''");
const playing = (page) =>
  page.eval(
    "[...document.querySelectorAll('audio')].some(audio => !audio.paused && audio.currentTime > 0)",
  );

try {
  await until(async () => {
    if (next.exitCode !== null) throw new Error(`Next.js exited during startup (${next.exitCode})`);
    try {
      const response = await fetch(`${frontendUrl}/login`);
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  }, "Next.js startup");
  let debugging;
  await until(async () => {
    try {
      debugging = (await readFile(join(artifacts, "browser", "DevToolsActivePort"), "utf8")).split(
        "\n",
      )[0];
      return Boolean(debugging);
    } catch {
      return false;
    }
  }, "headless browser startup");
  const page = async () => {
    const target = await (
      await fetch(`http://127.0.0.1:${debugging}/json/new?about:blank`, { method: "PUT" })
    ).json();
    const page = await Cdp.open(target.webSocketDebuggerUrl);
    sessions.push(page);
    await page.send("Runtime.enable");
    await page.send("Page.enable");
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      // Effects are off by default. Enable one explicitly for the fullscreen
      // renderer checks instead of depending on a previous browser preference.
      source: `localStorage.setItem("music-streaming.player-effects", JSON.stringify({ effect: "aurora", intensity: 65, sensitivity: 65 }));`,
    });
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.send("Network.setCookie", {
      name: "ms_session",
      value: Buffer.from(JSON.stringify(user)).toString("base64url"),
      url: frontendUrl,
    });
    for (const [name, value] of [
      ["ms_refresh", "fixture-refresh"],
      ["ms_access", "fixture-access"],
      ["ms_locale", "en"],
    ])
      await page.send("Network.setCookie", { name, value, url: frontendUrl });
    await page.send("Page.navigate", { url: `${frontendUrl}/tracks` });
    await until(
      () => page.eval("Boolean(document.querySelector('[aria-label=\"Play First tone\"]'))"),
      "track list hydration",
    );
    return { page, target };
  };
  const renderer = await page();
  const controller = await page();
  console.log("Both player pages loaded");
  await until(() => devices.size === 2, "both playback devices online");
  await renderer.page.send("Page.bringToFront");
  await click(renderer.page, "Play First tone");
  await until(() => playing(renderer.page), "renderer audio started");
  console.log("Renderer started");
  const mediaRace = await renderer.page.eval(`(async () => {
    const audio = [...document.querySelectorAll('audio')].find(audio => !audio.paused);
    const events = [];
    const record = event => events.push(event.type);
    audio.addEventListener('play', record);
    audio.addEventListener('pause', record);
    const before = audio.currentTime;
    try {
      // Both events are queued, but paused is already false when pause arrives.
      audio.pause();
      await audio.play();
      await new Promise(resolve => setTimeout(resolve, 750));
      return { events, paused: audio.paused, advanced: audio.currentTime > before,
        displayedPlaying: navigator.mediaSession.playbackState === 'playing' };
    } finally {
      audio.removeEventListener('play', record);
      audio.removeEventListener('pause', record);
    }
  })()`);
  assert.deepEqual(mediaRace.events, ["pause", "play"], "media events must not feed back");
  assert.equal(mediaRace.paused, false, "quick pause/resume keeps audio playing");
  assert.equal(mediaRace.advanced, true, "playback position advances after the race");
  assert.equal(mediaRace.displayedPlaying, true, "player state matches actual audio");
  console.log("Queued pause/play regression passed");
  await renderer.page.eval(`(() => {
    const audio = [...document.querySelectorAll('audio')].find(audio => !audio.paused);
    audio.currentTime = audio.duration;
  })()`);
  await until(
    () =>
      renderer.page.eval(`[...document.querySelectorAll('audio')].some(audio =>
      audio.currentSrc.includes(${JSON.stringify(tracks[1].id)}) && !audio.paused && audio.currentTime > 0.2
    )`),
    "the next track plays after the active audio reaches its end",
  );
  assert.equal(await renderer.page.eval("navigator.mediaSession.playbackState"), "playing");
  await click(renderer.page, "Play First tone");
  await until(
    async () =>
      (await text(renderer.page)).includes("First tone") && (await playing(renderer.page)),
    "renderer restarted on the first track",
  );
  console.log("Automatic track advance passed");
  await until(
    async () => (await text(controller.page)).includes("First tone"),
    "controller mirrors the renderer",
  );
  assert.equal(await playing(controller.page), false, "controller must not play audio");
  // Shuffle the entire existing queue, including the previous history, and
  // then follow exactly the sequence shown in the remote queue panel.
  for (const title of ["Second tone", "Third tone"]) {
    await click(controller.page, "Next track");
    await until(async () => (await text(renderer.page)).includes(title), `advance to ${title}`);
  }
  const activeTime = () =>
    renderer.page.eval(
      `[...document.querySelectorAll('audio')].find(audio => !audio.paused && audio.currentSrc.includes(${JSON.stringify(tracks[2].id)}))?.currentTime || 0`,
    );
  await until(async () => (await activeTime()) > 0.2, "last track audio started");
  const beforeShuffleTime = await activeTime();
  await controller.page.eval(
    `document.querySelector('footer.player-shell button[aria-label="Shuffle"]').click()`,
  );
  await until(
    () => playback?.shuffle && playback.index === 0 && playback.trackIds[0] === tracks[2].id,
    "whole queue shuffled from the last track",
  );
  const shuffledIds = [...playback.trackIds];
  assert.deepEqual([...shuffledIds].sort(), tracks.map((track) => track.id).sort());
  assert.deepEqual(playback.order, [0, 1, 2]);
  assert(
    (await activeTime()) >= beforeShuffleTime - 0.1,
    "shuffling preserves the playing track and its position",
  );
  await click(controller.page, "Playback queue");
  const shuffledTitles = shuffledIds.map((id) => tracks.find((track) => track.id === id).title);
  await until(
    async () =>
      JSON.stringify(
        await controller.page.eval(
          `[...document.querySelectorAll('[data-queue-panel] .queue-row .font-semibold')].map(row => row.textContent)`,
        ),
      ) === JSON.stringify(shuffledTitles),
    "visible queue matches the physical shuffled sequence",
  );
  const collectionQueue = [...playback.trackIds];
  const collectionIndex = playback.index;
  const collectionPlays = commands.filter((command) => command.type === "play").length;
  const navigate = async (href) => {
    await controller.page.eval(`(() => {
      const link = [...document.querySelectorAll('a')].find(link => link.getAttribute('href') === ${JSON.stringify(href)});
      if (!link) throw Error('Missing navigation link: ' + ${JSON.stringify(href)});
      link.click();
    })()`);
    await until(
      () => controller.page.eval(`location.pathname === ${JSON.stringify(href)}`),
      `navigate to ${href}`,
    );
  };
  const backToCatalog = async (href) => {
    await controller.page.eval("history.back()");
    await until(
      () =>
        controller.page.eval(`location.pathname === ${JSON.stringify(href)} &&
        Boolean(document.querySelector('main a[href="/albums"]'))`),
      `return to the catalog at ${href}`,
    );
  };
  const toggleCollection = async (scope, name) => {
    const pause = `${scope} button[aria-label="Pause"]`;
    const play = `${scope} button[aria-label="Play ${name}"]`;
    await until(
      () => controller.page.eval(`Boolean(document.querySelector(${JSON.stringify(pause)}))`),
      `${name} pause icon`,
    );
    await controller.page.eval(`document.querySelector(${JSON.stringify(pause)}).click()`);
    await until(() => playback?.isPlaying === false, `${name} pauses the renderer`);
    await until(
      () => controller.page.eval(`Boolean(document.querySelector(${JSON.stringify(play)}))`),
      `${name} play icon`,
    );
    await controller.page.eval(`document.querySelector(${JSON.stringify(play)}).click()`);
    await until(() => playback?.isPlaying === true, `${name} resumes the renderer`);
    assert.deepEqual(
      playback.trackIds,
      collectionQueue,
      `${name} must preserve the shuffled queue`,
    );
    assert.equal(playback.index, collectionIndex, `${name} must preserve the selected track`);
    assert.equal(
      commands.filter((command) => command.type === "play").length,
      collectionPlays,
      `${name} must not restart playback`,
    );
  };
  await navigate(`/albums/${albumId}`);
  await toggleCollection("#content header", "Test album");
  await backToCatalog("/tracks");
  await navigate("/playlists");
  await until(
    () =>
      controller.page.eval(`Boolean(document.querySelector('a[href="/playlists/${playlistId}"]'))`),
    "playlist card loaded",
  );
  await navigate(`/playlists/${playlistId}`);
  await toggleCollection("#content header", "Test playlist");
  await backToCatalog("/playlists");
  await toggleCollection("#content .media-card", "Test playlist");
  await navigate("/albums");
  await toggleCollection("#content .media-card", "Test album");
  await navigate("/tracks");
  console.log("Collection header and card play/pause controls passed after shuffle");
  for (let index = 1; index < shuffledIds.length; index++) {
    await click(controller.page, "Next track");
    await until(
      () => playback?.index === index && playback.trackIds[index] === shuffledIds[index],
      `sequential shuffled queue entry ${index}`,
    );
    assert.deepEqual(playback.trackIds, shuffledIds, "next must not reshuffle the queue");
  }
  await controller.page.eval(
    `document.querySelector('footer.player-shell button[aria-label="Shuffle"]').click()`,
  );
  await until(() => playback?.shuffle === false, "shuffle disabled");
  await click(controller.page, "Playback queue");
  // The final shuffled entry can already be First tone, whose row button
  // toggles playback. Choose another song before starting the regular queue.
  await click(controller.page, "Play Third tone");
  await until(
    async () =>
      playback?.index === 0 &&
      playback.trackIds[0] === tracks[2].id &&
      (await text(controller.page)).includes("Third tone"),
    "another track selected before restoring the regular queue",
  );
  await click(controller.page, "Play First tone");
  await until(
    () => playback?.index === 0 && playback.trackIds[0] === tracks[0].id,
    "regular queue restored for transport checks",
  );
  await until(() => playing(renderer.page), "regular queue playback resumed");
  console.log("Whole queue shuffle and sequential visible playback passed");
  await click(controller.page, "Pause");
  await until(async () => !(await playing(renderer.page)), "remote pause applied");
  await click(controller.page, "Next track");
  await until(
    async () =>
      (await text(renderer.page)).includes("Second tone") &&
      (await text(controller.page)).includes("Second tone"),
    "remote next mirrored on both players",
  );
  await until(() => playing(renderer.page), "next track started on renderer");
  console.log("Remote transport controls passed");
  await controller.page.eval(
    `(() => { const input = document.querySelector('input[aria-label="Volume"]'); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); })()`,
  );
  await until(
    () => commands.some((command) => command.type === "setVolume") && playback?.volume === 0.95,
    "existing volume control changed the renderer volume",
  );
  await controller.page.eval(
    `document.querySelector('input[aria-label^="Seek"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`,
  );
  await delay(100);
  await controller.page.eval(
    `document.querySelector('input[aria-label^="Seek"]').dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))`,
  );
  await until(
    () => commands.some((command) => command.type === "seek"),
    "existing seek control sent a remote command",
  );
  await controller.page.eval(
    `document.querySelector('footer button[title^="Playing on"]').click()`,
  );
  await until(
    () => controller.page.eval("Boolean(document.querySelector('[role=dialog]'))"),
    "device selector opened",
  );
  await controller.page.eval(
    `Array.from(document.querySelectorAll('[role=dialog] button')).find(button => button.textContent.includes('This device')).click()`,
  );
  await controller.page.send("Page.bringToFront");
  await until(() => playing(controller.page), "playback transferred here");
  await until(
    async () => !(await playing(renderer.page)),
    "previous renderer stopped after transfer",
  );
  console.log("Transfer here passed");
  assert((await text(controller.page)).includes("Second tone"));
  await controller.page.eval(
    `document.querySelector('footer button[title="Playback devices"]').click()`,
  );
  await until(
    () => controller.page.eval("Boolean(document.querySelector('[role=dialog]'))"),
    "device selector reopened",
  );
  await controller.page.eval(
    `Array.from(document.querySelectorAll('[role=dialog] button')).find(button => button.textContent.includes('Test output')).click()`,
  );
  await renderer.page.send("Page.bringToFront");
  await until(() => playing(renderer.page), "playback transferred back to first device");
  await until(
    async () => !(await playing(controller.page)),
    "controller remained silent after transfer back",
  );
  await click(controller.page, "Playback queue");
  await controller.page.eval(`(() => {
    const edit = [...document.querySelectorAll('[data-queue-panel] button')].find(button =>
      button.textContent.trim() === 'Edit queue'
    );
    if (!edit) throw Error('Missing queue edit button');
    edit.click();
  })()`);
  await until(
    () =>
      controller.page.eval(
        "Boolean(document.querySelector('[aria-label=\"Remove Third tone from the queue\"]'))",
      ),
    "remote queue opened",
  );
  await click(controller.page, "Remove Third tone from the queue");
  await until(() => playback?.trackIds.length === 2, "queue deletion reached the renderer");
  await controller.page.eval(`(() => {
    const history = document.querySelector('[data-queue-panel] button[aria-expanded="false"]');
    history?.click();
  })()`);
  await until(
    () =>
      controller.page.eval(
        "Boolean(document.querySelector('[aria-label=\"Reorder First tone\"]'))",
      ),
    "played queue entries revealed",
  );
  await controller.page.send("Page.bringToFront");
  await controller.page.eval(`(() => {
    const handle = document.querySelector('[aria-label="Reorder First tone"]');
    window.__queueHandleBeforeMove = handle;
    handle.focus();
  })()`);
  for (const [key, code, number] of [
    [" ", "Space", 32],
    ["ArrowDown", "ArrowDown", 40],
    [" ", "Space", 32],
  ]) {
    await controller.page.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code,
      windowsVirtualKeyCode: number,
    });
    await controller.page.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      windowsVirtualKeyCode: number,
    });
    await delay(250);
  }
  await until(
    () => playback?.trackIds[0] === tracks[1].id,
    "keyboard queue reordering reached the renderer",
  );
  assert.equal(
    await controller.page.eval(
      "window.__queueHandleBeforeMove === document.querySelector('[aria-label=\"Reorder First tone\"]')",
    ),
    true,
    "moving an occurrence preserves its DOM node",
  );
  await click(controller.page, "Open the full player");
  await until(
    () =>
      controller.page.eval(
        "Boolean(document.querySelector('[aria-label=\"Close the full player\"]'))",
      ),
    "lazy fullscreen player opened",
  );
  await until(
    () =>
      controller.page.eval(
        "Boolean(document.querySelector('canvas[data-player-effect][data-renderer]:not([data-renderer=\"unavailable\"])'))",
      ),
    "lazy effect renderer initialized",
  );
  assert.equal(
    await controller.page.eval("document.querySelectorAll('[role=dialog] .record').length"),
    1,
    "fullscreen mounts one responsive record",
  );
  await controller.page.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await delay(800);
  assert.equal(
    await controller.page.eval("document.querySelectorAll('[role=dialog] .record').length"),
    1,
    "resizing preserves the same single record",
  );
  assert.equal(
    await controller.page.eval("document.querySelector('[role=dialog] .record').dataset.axis"),
    "responsive",
  );
  await click(controller.page, "Close the full player");
  await until(
    () => controller.page.eval("!document.querySelector('canvas[data-player-effect]')"),
    "fullscreen cleans up its effect canvas",
  );
  await controller.page.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const shot = await controller.page.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(artifacts, "controller.png"), Buffer.from(shot.data, "base64"));
  await fetch(`http://127.0.0.1:${debugging}/json/close/${renderer.target.id}`);
  await until(() => devices.size === 1, "renderer disconnected");
  await until(
    async () => (await text(controller.page)).includes("unavailable"),
    "offline output is explicit in the existing player",
  );
  await click(controller.page, "Next track");
  assert.equal(
    await playing(controller.page),
    false,
    "losing the renderer must never start local audio",
  );
  assert.deepEqual(errors, [], "browser and API fixture should have no unhandled errors");
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "queued pause/play events settle without feedback",
        "automatic track advance keeps playing",
        "discovery",
        "mirrored player",
        "silent controller",
        "whole queue shuffle and sequential visible playback",
        "album and playlist header/card play-pause after shuffle",
        "pause",
        "next",
        "volume",
        "seek",
        "transfer here",
        "transfer back",
        "queue editing",
        "keyboard queue reorder and stable row identity",
        "lazy fullscreen and effects",
        "single responsive record",
        "fullscreen cleanup",
        "offline output",
      ],
      screenshot: join(artifacts, "controller.png"),
    }),
  );
} catch (error) {
  console.error(error);
  console.error(
    JSON.stringify({
      errors,
      commands,
      playback,
      requests: Object.fromEntries(requests),
      artifacts,
    }),
  );
  await writeFile(join(artifacts, "next.log"), serverLog);
  await writeFile(join(artifacts, "browser.log"), browserLog);
  for (const [index, page] of sessions.entries()) {
    try {
      const shot = await page.send("Page.captureScreenshot", { format: "png" });
      await writeFile(join(artifacts, `failure-${index}.png`), Buffer.from(shot.data, "base64"));
      await writeFile(
        join(artifacts, `failure-${index}.txt`),
        await page.eval("location.href + '\\n' + document.body.innerText"),
      );
      console.error(
        await page.eval(
          "JSON.stringify([...document.querySelectorAll('audio')].map(a => ({src:a.currentSrc,paused:a.paused,time:a.currentTime,ready:a.readyState,network:a.networkState,error:a.error?.message})))",
        ),
      );
    } catch {
      /* A disconnected tab may no longer have a screenshot. */
    }
  }
  process.exitCode = 1;
} finally {
  for (const session of sessions) session.close();
  if (process.platform === "win32") {
    for (const child of [browser, next])
      if (child.pid && child.exitCode === null)
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
  } else {
    browser.kill();
    next.kill();
  }
  for (const device of devices.values()) device.response.end();
  for (const response of pending.values()) response.end();
  backend.closeAllConnections();
  backend.close();
}

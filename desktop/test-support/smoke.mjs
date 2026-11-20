// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { albumId, fixture, track } from "./server.mjs";

const require = createRequire(import.meta.url);
const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
const executable = process.argv[2]
  ? resolve(process.argv[2])
  : require("electron");
const portable = process.argv.includes("--portable");
const root = await mkdtemp(join(tmpdir(), "caimack-smoke-"));
const profile = portable
  ? join(dirname(executable), "Caimack Data")
  : process.argv[2]
    ? join(root, "Caimack")
    : join(root, "development");
const server = await fixture({ trackCount: 51, isAdmin: true });
let electron;
let socket;
let logs = "";
let messages = [];

async function until(check, label, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch {}
    if (electron && electron.exitCode !== null)
      throw new Error("Electron exited during " + label);
    await sleep(80);
  }
  throw new Error("Timed out during " + label);
}

let sequence = 1;
function command(method, params) {
  const id = sequence++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Chromium call timed out " + method)),
      5000,
    );
    const handler = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", handler);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    };
    socket.addEventListener("message", handler);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    userGesture: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    );
  return result.result.value;
}

async function start() {
  await rm(join(profile, "DevToolsActivePort"), { force: true });
  logs = "";
  messages = [];
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: root,
    APPDATA: root,
    CAIMACK_DESKTOP_TEST_PROFILE: profile,
    APPIMAGE_EXTRACT_AND_RUN: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  electron = spawn(
    executable,
    [
      ...(process.argv[2] ? [] : [desktop]),
      "--remote-debugging-port=0",
      "--lang=en-US",
      ...(process.platform === "linux" ? ["--ozone-platform=headless"] : []),
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  electron.stdout.on("data", (data) => {
    logs += data;
  });
  electron.stderr.on("data", (data) => {
    logs += data;
  });
  electron.on("error", (error) => {
    logs += error.message;
  });
  const debuggerUrl = await until(async () => {
    const [port] = (
      await readFile(join(profile, "DevToolsActivePort"), "utf8")
    ).split("\n");
    const pages = await (
      await fetch("http://127.0.0.1:" + port + "/json/list")
    ).json();
    return pages.find((page) =>
      page.url.startsWith("https://caimack.desktop.invalid"),
    )?.webSocketDebuggerUrl;
  }, "waiting for Chromium");
  socket = new WebSocket(debuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", ({ data }) => {
    const event = JSON.parse(data);
    if (event.method === "Runtime.exceptionThrown")
      messages.push(event.params.exceptionDetails.exception?.description);
  });
  await command("Runtime.enable");
}

async function stop() {
  const running = electron;
  if (running?.exitCode === null) {
    try {
      await command("Browser.close");
    } catch {}
    await Promise.race([once(running, "exit"), sleep(2000)]);
    if (running.exitCode === null) running.kill();
  }
  socket?.close();
  electron = null;
}

async function request(path, body) {
  const encoded = JSON.stringify(path);
  return evaluate(
    `fetch(${encoded}, ${
      body === undefined
        ? "undefined"
        : JSON.stringify({
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
    }).then(async r => ({ status: r.status, body: await r.json() }))`,
  );
}

try {
  await start();
  await until(
    () => evaluate("!!document.querySelector('input[type=url]')"),
    "connection screen",
  );
  const setup = await evaluate(`(() => {
    const main = document.querySelector("main");
    const logo = main.querySelector("svg");
    const button = main.querySelector("button").getBoundingClientRect();
    return {
      layout: getComputedStyle(main).display,
      logoWidth: logo.getBoundingClientRect().width,
      submitInView: button.width > 0 && button.top >= 0 && button.bottom <= innerHeight,
    };
  })()`);
  assert.equal(setup.layout, "grid");
  assert.ok(
    setup.logoWidth > 0 && setup.logoWidth <= 64,
    "The setup logo must fit the form",
  );
  assert.ok(setup.submitInView, "The connection button must be visible");
  await evaluate("document.querySelector('input[type=url]').focus()");
  await command("Input.insertText", { text: server.origin });
  await evaluate("document.querySelector('input[type=checkbox]').click()");
  await evaluate("document.querySelector('form button').click()");
  await until(
    () => evaluate("!!document.querySelector('#username')"),
    "login screen",
  );
  await evaluate("document.querySelector('#username').focus()");
  await command("Input.insertText", { text: "tester" });
  await evaluate("document.querySelector('#password').focus()");
  await command("Input.insertText", { text: "test-password" });
  await evaluate("document.querySelector('form').requestSubmit()");
  await until(
    async () =>
      (await request("/desktop/status")).body.user?.username === "tester",
    "login",
  );
  await until(
    () => evaluate("!!document.querySelector('.app-shell aside')"),
    "web layout",
  );
  assert.equal(
    await evaluate(
      "getComputedStyle(document.querySelector('.app-shell')).display",
    ),
    "grid",
  );
  await until(
    () => evaluate("!!document.querySelector('a[href=\"/downloads\"]')"),
    "downloads navigation",
  );
  const desktopViewport = {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  };
  await command("Emulation.setDeviceMetricsOverride", desktopViewport);
  await evaluate(`document.querySelector('aside a[href="/search"]').click()`);
  const categories = '[role="group"][aria-label="Result types"]';
  const categoryButtons = `[...document.querySelectorAll(${JSON.stringify(categories + " button")})]`;
  await until(
    () => evaluate(`${categoryButtons}.length === 6`),
    "search categories",
  );
  assert.deepEqual(
    await evaluate(`${categoryButtons}.map(button => button.textContent)`),
    ["All", "Tracks", "Albums", "Artists", "Playlists", "Genres"],
  );
  const popularSection = `[...document.querySelectorAll("#content h2")]
    .find(heading => heading.textContent === "Most played tracks")?.closest("section")`;
  const popularList = `${popularSection}?.querySelector("ol")`;
  await until(
    () => evaluate(`${popularList}?.children.length === 10`),
    "popular search tracks",
  );
  assert.deepEqual(
    await evaluate(
      `[...document.querySelectorAll("#content h2")].map(heading => heading.textContent)`,
    ),
    [
      "Browse by genre",
      "Most played tracks",
      "Most played albums",
      "Most played artists",
    ],
  );
  for (const width of [1440, 390]) {
    await command("Emulation.setDeviceMetricsOverride", {
      ...desktopViewport,
      width,
    });
    assert.equal(
      await evaluate(`getComputedStyle(${popularSection}).backgroundColor`),
      "rgba(0, 0, 0, 0)",
    );
    assert.equal(
      await evaluate(
        `[...${popularList}.children].filter(row => row.getClientRects().length).length`,
      ),
      10,
    );
  }
  await command("Emulation.setDeviceMetricsOverride", desktopViewport);
  await evaluate(
    `${categoryButtons}.find(button => button.textContent === "Tracks").click()`,
  );
  const pagination = '[aria-label="Pagination"]';
  const pageNumber = `document.querySelector(${JSON.stringify(pagination + " span")})?.textContent`;
  const measureTrackToolbar = `(() => {
    const catalog = [...document.querySelectorAll("#content .track-catalog")]
      .find(element => element.getClientRects().length);
    const toolbar = catalog.querySelector(".library-toolbar");
    const table = catalog.querySelector('[role="table"]');
    const controls = [...toolbar.querySelectorAll("button")]
      .filter(button => button.getClientRects().length)
      .map(button => button.getBoundingClientRect().toJSON());
    const bounds = toolbar.getBoundingClientRect();
    const play = toolbar.querySelector('button[aria-label="Play"]');
    return {
      controls,
      verticalGap: table.getBoundingClientRect().top - bounds.bottom,
      fits: controls.every(control => control.left >= bounds.left && control.right <= bounds.right + 1),
      roundPlay: parseFloat(getComputedStyle(play).borderTopLeftRadius) >= play.offsetWidth / 2,
    };
  })()`;
  async function assertTrackToolbar(wide) {
    const { controls, verticalGap, fits, roundPlay } =
      await evaluate(measureTrackToolbar);
    assert.ok(
      fits && verticalGap >= 0 && verticalGap <= 12,
      "Track toolbar should fit above the table",
    );
    assert.ok(roundPlay, "The playback button should be round");
    assert.equal(controls.length, wide ? 7 : 3);
    assert.ok(
      controls.every(
        (control) => Math.abs(control.height - controls[0].height) <= 1,
      ),
    );
    if (wide)
      assert.ok(
        controls.every(
          (control) => Math.abs(control.top - controls[0].top) <= 1,
        ),
      );
  }
  await until(
    () => evaluate(`${pageNumber} === "Page 1 of 2"`),
    "pagination in the Tracks tab",
  );
  await assertTrackToolbar(true);
  await command("Emulation.setDeviceMetricsOverride", {
    ...desktopViewport,
    width: 390,
  });
  await assertTrackToolbar(false);
  const filterButton = `document.querySelector('.track-catalog button[aria-controls]')`;
  const sortButton = `document.querySelector('.track-catalog button[aria-label="Sort by"]')`;
  await evaluate(`${filterButton}.click()`);
  assert.equal(
    await evaluate(`${filterButton}.getAttribute('aria-expanded')`),
    "true",
  );
  assert.ok(await evaluate(`Boolean(${sortButton}?.getClientRects().length)`));
  await evaluate(`${filterButton}.click()`);
  assert.equal(
    await evaluate(`${filterButton}.getAttribute('aria-expanded')`),
    "false",
  );
  assert.equal(await evaluate(`${sortButton}?.getClientRects().length`), 0);
  await command("Emulation.setDeviceMetricsOverride", desktopViewport);
  await evaluate(
    `document.querySelector(${JSON.stringify(pagination + " button:last-child")}).click()`,
  );
  await until(
    () =>
      evaluate(
        `${pageNumber} === "Page 2 of 2" && document.querySelector("#content").textContent.includes("Catalog track 51")`,
      ),
    "second page of all tracks",
  );
  async function checkCatalogTab(name, content, width) {
    await evaluate(
      `${categoryButtons}.find(button => button.textContent === ${JSON.stringify(name)}).click()`,
    );
    await until(
      () =>
        evaluate(
          `document.querySelector("#content").innerText.includes(${JSON.stringify(content)})`,
        ),
      name + " catalog",
    );
    const measure = await evaluate(`(() => {
      const toolbar = [...document.querySelectorAll(".search-catalog-toolbar")]
        .find(element => element.getClientRects().length);
      const tabs = document.querySelector(${JSON.stringify(categories)}).getBoundingClientRect();
      const panel = toolbar.getBoundingClientRect();
      const content = document.querySelector("#content");
      return {
        topGap: panel.top - tabs.bottom,
        leftGap: panel.left - tabs.left,
        contained: content.scrollWidth <= content.clientWidth + 1,
        centers: [...toolbar.children].map(child => {
          const rect = child.getBoundingClientRect();
          return (rect.top + rect.bottom) / 2;
        })
      };
    })()`);
    assert.ok(
      measure.topGap >= 0 && measure.topGap <= 14,
      name + " tab spacing",
    );
    assert.ok(
      Math.abs(measure.leftGap) <= 1 && measure.contained,
      name + " alignment",
    );
    if (width > 768)
      assert.ok(
        measure.centers.every(
          (center) => Math.abs(center - measure.centers[0]) <= 1,
        ),
        name + " toolbar alignment",
      );
  }
  const layouts = [
    ["Albums", "Another Album"],
    ["Artists", "Another Artist"],
    ["Playlists", "Test Playlist"],
    ["Genres", "Rock"],
  ];
  for (const width of [1440, 390]) {
    await command("Emulation.setDeviceMetricsOverride", {
      ...desktopViewport,
      width,
    });
    for (const [name, content] of layouts)
      await checkCatalogTab(name, content, width);
    assert.ok(
      await evaluate(`(() => {
      const tabs = document.querySelector(${JSON.stringify(categories)});
      const active = tabs.querySelector('[aria-pressed="true"]').getBoundingClientRect();
      return active.right <= tabs.getBoundingClientRect().right + 1;
    })()`),
    );
  }
  await evaluate(
    `[...document.querySelectorAll("#content button.media-card")].find(button => button.textContent.includes("Rock")).click()`,
  );
  await until(
    () =>
      evaluate(
        `!!document.querySelector('#content .section-heading button[aria-label="Play"]') && document.querySelector("#content").innerText.includes("Offline Track")`,
      ),
    "playback in the selected genre heading",
  );
  await command("Emulation.setDeviceMetricsOverride", desktopViewport);
  await evaluate(
    `${categoryButtons}.find(button => button.textContent === "All").click()`,
  );
  await evaluate(
    `document.querySelector('#content input[type="search"]').focus()`,
  );
  await command("Input.insertText", { text: "test" });
  await until(
    () =>
      evaluate(
        `document.querySelector("#content").innerText.includes("Top result") && document.querySelector("#content").innerText.includes("Another Artist")`,
      ),
    "combined search results",
  );
  assert.equal(
    await evaluate(`(() => {
    const card = document.querySelector("#content .listening-panel");
    const play = card.querySelector('button').getBoundingClientRect();
    const panel = card.getBoundingClientRect();
    return panel.height < 112 && Math.abs(play.top + play.height / 2 - panel.top - panel.height / 2) <= 1;
  })()`),
    true,
    "Top result should be compact and its playback button centered",
  );
  await evaluate(
    `${categoryButtons}.find(button => button.textContent === "Tracks").click()`,
  );
  await until(
    () => evaluate(`new URL(location.href).searchParams.get("q") === "test"`),
    "query in Tracks",
  );
  await evaluate(
    `${categoryButtons}.find(button => button.textContent === "Playlists").click()`,
  );
  assert.ok(
    await evaluate(`(() => {
    const params = new URL(location.href).searchParams;
    return params.get("tab") === "playlists" && params.get("q") === "test";
  })()`),
  );
  await evaluate(`localStorage.setItem("music-streaming.yandexMusic", "on");
    localStorage.setItem("music-streaming.yandexMusic.token", "fixture-only");
    history.replaceState(null, "", "/search?tab=yandex&q=test");
    setTimeout(() => location.reload(), 20);`);
  await until(
    () =>
      evaluate(
        `document.querySelector("#content")?.innerText.includes("Another Yandex Track")`,
      ),
    "Yandex Music search results",
  );
  const yandexActionsAlign = `(() => {
    const buttons = [...document.querySelectorAll("#content li button")].map(button => button.getBoundingClientRect());
    return buttons.length === 2 && buttons[0].left === buttons[1].left && buttons[0].right === buttons[1].right;
  })()`;
  for (const width of [1440, 390]) {
    await command("Emulation.setDeviceMetricsOverride", {
      ...desktopViewport,
      width,
    });
    assert.ok(
      await evaluate(yandexActionsAlign),
      "Yandex Music actions should share a column",
    );
  }
  await command("Emulation.setDeviceMetricsOverride", desktopViewport);
  await evaluate(`localStorage.removeItem("music-streaming.yandexMusic");
    localStorage.removeItem("music-streaming.yandexMusic.token");`);
  await evaluate(`history.pushState(null, "", "/albums/${albumId}")`);
  await until(
    () =>
      evaluate(
        "!!document.querySelector('[data-collection-download=\"available\"]')",
      ),
    "album download action",
  );
  assert.equal(
    await evaluate(`(() => {
    const download = document.querySelector("[data-collection-download]");
    const playback = download.closest("header").querySelector(".lucide-play").closest("button");
    return download.parentElement !== playback.parentElement &&
      download.getBoundingClientRect().left > playback.getBoundingClientRect().right &&
      !!download.querySelector(".lucide-download");
  })()`),
    true,
  );
  await command("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  const transfer = Promise.withResolvers();
  server.state.streamGate = { release: transfer.promise, unknownSize: true };
  await evaluate(
    'document.querySelector("[data-collection-download]").click()',
  );
  await until(async () => {
    const download = (await request("/desktop/status")).body.downloads[0];
    return (
      download?.status === "running" &&
      download.bytes > 0 &&
      download.total === null
    );
  }, "streaming audio without a content length");
  await until(
    () =>
      evaluate(`(() => {
    const progress = document.querySelector('[data-collection-download="pending"] [data-download-progress="indeterminate"]');
    return progress && getComputedStyle(progress).animationName !== "none";
  })()`),
    "animated album download indicator",
  );
  transfer.resolve();
  await until(
    async () =>
      (await request("/desktop/status")).body.downloads[0]?.status ===
      "complete",
    "song download",
  );
  await until(
    () =>
      evaluate(
        "!!document.querySelector('[data-collection-download=\"complete\"] .lucide-circle-arrow-down')",
      ),
    "downloaded album icon",
  );
  assert.equal(
    await evaluate(`(() => {
    const badge = document.querySelector("[data-download-badge]");
    const duration = badge.closest("[role=row]").querySelector("[data-track-duration]");
    const menu = badge.parentElement.querySelector("button");
    return !!badge.querySelector(".lucide-circle-arrow-down") &&
      duration.getBoundingClientRect().right <= badge.getBoundingClientRect().left &&
      badge.getBoundingClientRect().right <= menu.getBoundingClientRect().left;
  })()`),
    true,
  );
  await evaluate(
    'document.querySelector("[data-collection-download]").click()',
  );
  await until(
    () =>
      evaluate(
        "!!document.querySelector('[data-collection-download=\"available\"]')",
      ),
    "removing the first album download",
  );
  const knownTransfer = Promise.withResolvers();
  server.state.streamGate = { release: knownTransfer.promise };
  await evaluate(
    'document.querySelector("[data-collection-download]").click()',
  );
  await until(
    () =>
      evaluate(`(() => {
    const arc = document.querySelector('[data-collection-download="pending"] [data-download-progress="determinate"] circle[pathLength]');
    const offset = Number(arc?.getAttribute("stroke-dashoffset"));
    return arc && offset > 0 && offset < 1 && getComputedStyle(arc).transitionProperty === "stroke-dashoffset";
  })()`),
    "animated byte progress for an album download",
  );
  knownTransfer.resolve();
  await until(
    () =>
      evaluate(
        "!!document.querySelector('[data-collection-download=\"complete\"]')",
      ),
    "completing the second album download",
  );
  const lyrics = await request("/api/tracks/" + track.id + "/lyrics");
  assert.equal(lyrics.body.plain, "hello");
  await stop();

  server.state.online = false;
  await start();
  await until(
    () => evaluate("!!document.querySelector('.app-shell aside')"),
    "offline restart",
  );
  await until(
    () =>
      evaluate(
        "document.querySelector('.daily-mix h2')?.textContent === 'Downloaded'",
      ),
    "downloaded music on the offline home page",
  );
  await until(
    () =>
      evaluate(
        "document.querySelector('.radio-status')?.textContent.includes('From your local collection')",
      ),
    "local radio on offline home",
  );
  await evaluate("document.querySelector('.radio-start').click()");
  await until(
    () =>
      evaluate(
        "[...document.querySelectorAll('audio')].some(audio => !audio.paused && audio.currentTime > 0)",
      ),
    "offline radio playback",
  );
  await evaluate("document.querySelector('.radio-start').click()");
  await evaluate("document.querySelector('.daily-mix-header button').click()");
  await until(
    () =>
      evaluate(
        "[...document.querySelectorAll('audio')].some(audio => !audio.paused && audio.currentTime > 0)",
      ),
    "playback from offline home",
  );
  await evaluate("document.querySelector('.daily-mix-header button').click()");
  await evaluate("document.querySelector('a[href=\"/downloads\"]').click()");
  await until(
    () =>
      evaluate(
        "document.querySelector('main h1')?.textContent === 'Downloads'",
      ),
    "downloads screen",
  );
  await evaluate(
    `[...document.querySelectorAll("main button")].find(button => button.textContent.trim() === ${JSON.stringify(track.title)}).click()`,
  );
  await until(
    () =>
      evaluate(
        "[...document.querySelectorAll('audio')].some(audio => !audio.paused && audio.currentTime > 0)",
      ),
    "offline audio decoder",
  );
  assert.deepEqual(messages, []);
  console.log(
    "Electron opened the shared web library, downloaded audio, and played it after an offline restart.",
  );
} catch (reason) {
  if (socket?.readyState === WebSocket.OPEN) {
    const text = await evaluate("document.body?.innerText").catch(() => "");
    console.error("Visible application text:", text);
  }
  console.error(logs, messages, reason);
  process.exitCode = 1;
} finally {
  await stop();
  await server.close();
  await rm(root, { recursive: true, force: true, maxRetries: 3 }).catch(
    () => {},
  );
}

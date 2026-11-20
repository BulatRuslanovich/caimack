// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

function intercepts(request: Request, search = ""): boolean {
  const listeners = new Map<string, (event: unknown) => void>();
  runInNewContext(source, {
    self: {
      location: { origin: "https://music.test", search },
      addEventListener: (name: string, listener: (event: unknown) => void) =>
        listeners.set(name, listener),
    },
    URL,
    Set,
    Promise,
  });
  const respondWith = vi.fn((response: Promise<Response>) => void response.catch(() => {}));
  listeners.get("fetch")!({ request, respondWith });
  return respondWith.mock.calls.length > 0;
}

it("leaves progressive audio and Range requests to the browser network stack", () => {
  const request = new Request(
    "https://music.test/api/tracks/00000000-0000-0000-0000-000000000001/stream",
    { headers: { Range: "bytes=0-" } },
  );
  expect(intercepts(request)).toBe(false);
});

it("never serves saved playback and background job statuses", () => {
  for (const path of [
    "/api/playback/now",
    "/api/library/scan",
    "/api/integrations/yandex-music/imports",
    "/api/audiobooks",
    "/api/audiobooks/book/chapters/chapter/stream",
  ]) {
    expect(intercepts(new Request(`https://music.test${path}`))).toBe(false);
  }
});

it("serves byte ranges from explicitly downloaded audiobook chapters", async () => {
  const downloadedChapter = runInNewContext(`${source}\ndownloadedChapter`, {
    self: { location: { origin: "https://music.test", search: "" }, addEventListener: vi.fn() },
    caches: {
      open: async () => ({
        match: async () =>
          new Response("0123456789", { headers: { "Content-Type": "audio/mpeg" } }),
      }),
    },
    Response,
  }) as (request: Request) => Promise<Response>;
  const url = "https://music.test/__caimack/audiobooks/account/book/audio/chapter";
  const request = new Request(url, { headers: { Range: "bytes=3-5" } });
  expect(intercepts(request)).toBe(true);
  const response = await downloadedChapter(request);
  expect(response.status).toBe(206);
  expect(response.headers.get("Content-Range")).toBe("bytes 3-5/10");
  expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
  expect(await response.text()).toBe("345");

  const invalid = await downloadedChapter(new Request(url, { headers: { Range: "bytes=10-" } }));
  expect(invalid.status).toBe(416);
});

it("leaves Next.js chunks to the network under next dev", () => {
  const chunk = new Request("https://music.test/_next/static/chunks/_013ufyf._.js");
  expect(intercepts(chunk, "?dev")).toBe(false);
  expect(intercepts(chunk)).toBe(true);
});

function worker(fetch: () => Promise<Response>, cached: Map<string, Response>) {
  const cache = { match: async (url: string) => cached.get(url), put: vi.fn() };
  const shell = runInNewContext(`${source}\nshell`, {
    self: { location: { origin: "https://music.test", search: "" }, addEventListener: vi.fn() },
    caches: { open: async () => cache },
    fetch,
    Response,
    Set,
    Promise,
  }) as (
    event: { waitUntil: (work: Promise<unknown>) => void },
    request: string,
  ) => Promise<Response>;
  return (path: string) => shell({ waitUntil: () => {} }, path);
}

it("does not serve the cached home HTML when opening another route online", async () => {
  const shell = worker(
    async () => new Response("albums page"),
    new Map([["/", new Response("home page")]]),
  );
  expect(await (await shell("/albums")).text()).toBe("albums page");
});

it("keeps the saved route available when the network is unavailable", async () => {
  const shell = worker(
    async () => {
      throw new TypeError("Offline");
    },
    new Map([["/albums", new Response("saved albums")]]),
  );
  expect(await (await shell("/albums")).text()).toBe("saved albums");
});

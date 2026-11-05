// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

function environment() {
  const cache = {
    match: vi.fn(async () => new Response("old cover")),
    put: vi.fn(async () => {}),
    keys: vi.fn(async () => []),
  };
  const fetch = vi.fn(async () => new Response("new cover"));
  const handlers = new Map<string, (event: unknown) => void>();
  runInNewContext(source, {
    self: {
      location: { origin: "https://music.test", search: "" },
      addEventListener: (name: string, handler: (event: unknown) => void) =>
        handlers.set(name, handler),
    },
    caches: { open: async () => cache },
    fetch,
    Response,
    Request,
    URL,
  });
  const image = async () => {
    let result: Promise<Response> | undefined;
    const pending: Promise<unknown>[] = [];
    handlers.get("fetch")!({
      request: new Request(
        "https://music.test/api/albums/00000000-0000-0000-0000-000000000001/cover",
      ),
      respondWith: (response: Promise<Response>) => {
        result = response;
      },
      waitUntil: (work: Promise<unknown>) => pending.push(work),
    });
    const response = await result!;
    await Promise.all(pending);
    return response;
  };
  return { cache, fetch, image };
}

it("revalidates a previously cached cover after the page loses its image version map", async () => {
  const { fetch, image } = environment();
  expect(await (await image()).text()).toBe("new cover");
  expect((fetch.mock.calls[0] as unknown as [Request])[0].cache).toBe("no-cache");
});

it("keeps the saved cover available offline", async () => {
  const { fetch, image } = environment();
  fetch.mockRejectedValueOnce(new TypeError("offline"));
  expect(await (await image()).text()).toBe("old cover");
});

it("does not serve a cached private cover after authorization is refused", async () => {
  const { fetch, image } = environment();
  fetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
  expect((await image()).status).toBe(401);
});

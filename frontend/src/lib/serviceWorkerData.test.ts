// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const source = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
function environment() {
  const entries = new Map<string, { bytes: number }>();
  const cache = { match: vi.fn(async () => new Response("old")), put: vi.fn(async () => {}) };
  const fetch = vi.fn(async () => new Response("new"));
  const api = runInNewContext(
    `${source}
    putEntry=async(entry)=>entries.set(entry.url,entry);
    getEntry=async(url)=>entries.get(url);
    allEntries=async()=>[...entries.values()];
    ({data,store,total:()=>totalBytes})`,
    {
      self: { location: { search: "" }, addEventListener() {} },
      caches: { open: async () => cache },
      fetch,
      entries,
      Response,
      Request,
      URL,
      Date,
    },
  );
  return { api, cache, fetch };
}
it("returns fresh API data online, rather than the previous polling status", async () => {
  const { api, cache } = environment();
  const pending: Promise<unknown>[] = [];
  const response = await api.data(
    { waitUntil: (work: Promise<unknown>) => pending.push(work) },
    new Request("https://music.test/api/tracks"),
  );
  expect(await response.text()).toBe("new");
  await Promise.all(pending);
  expect(cache.put).toHaveBeenCalled();
});
it("uses the saved catalog only on network failure, not on authorization failure", async () => {
  const { api, fetch } = environment();
  fetch.mockRejectedValueOnce(new TypeError("offline"));
  expect(await (await api.data({}, "catalog")).text()).toBe("old");
  fetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
  expect((await api.data({}, "catalog")).status).toBe(401);
});
it("counts replacement and concurrent HLS writes exactly once", async () => {
  const { api, cache } = environment();
  const first = new Request("https://music.test/one");
  await api.store(cache, first, new Response("a".repeat(100)), "track");
  expect(api.total()).toBe(100);
  await Promise.all([
    api.store(cache, first, new Response("b".repeat(80)), "track"),
    api.store(cache, new Request("https://music.test/two"), new Response("c".repeat(40)), "track"),
  ]);
  expect(api.total()).toBe(120);
});

// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import { createCoverToneCache, type CoverTones } from "./coverToneCache";

const accent = { hue: 150, chroma: 0.1 };
const backdrop = { ...accent, lightness: 0.4 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("cover tone cache", () => {
  it("deduplicates in-flight sampling and keeps stable cached snapshots", async () => {
    const loading = deferred<CoverTones>();
    const sample = vi.fn(() => loading.promise);
    const cache = createCoverToneCache(sample);
    const first = cache.load("cover", "accent");
    expect(cache.load("cover", "accent")).toBe(first);
    loading.resolve({ accent });
    await first;
    expect(cache.get("cover", "accent")).toBe(accent);
    await cache.load("cover", "accent");
    expect(sample).toHaveBeenCalledTimes(1);
  });

  it("does not erase a valid accent when backdrop sampling fails", async () => {
    const cache = createCoverToneCache(async (_, kind) => {
      if (kind === "backdrop") throw new Error("decode failed");
      return { accent };
    });
    await cache.load("cover", "accent");
    await cache.load("cover", "backdrop");
    expect(cache.get("cover", "accent")).toBe(accent);
    expect(cache.get("cover", "backdrop")).toBeNull();
  });

  it("merges concurrent profiles independently, including a failed accent", async () => {
    const first = deferred<CoverTones>(),
      second = deferred<CoverTones>();
    const cache = createCoverToneCache((_, kind) =>
      kind === "accent" ? first.promise : second.promise,
    );
    const a = cache.load("cover", "accent"),
      b = cache.load("cover", "backdrop");
    second.resolve({ backdrop });
    await b;
    first.reject(new Error("canvas unavailable"));
    await a;
    expect(cache.get("cover", "backdrop")).toBe(backdrop);
    expect(cache.get("cover", "accent")).toBeNull();
  });

  it("only evicts when adding a new cover, not when completing its second profile", async () => {
    const cache = createCoverToneCache(
      async (_, kind) => (kind === "accent" ? { accent } : { backdrop }),
      2,
    );
    await cache.load("a", "accent");
    await cache.load("b", "accent");
    await cache.load("a", "backdrop");
    expect(cache.get("b", "accent")).toBe(accent);
    await cache.load("c", "accent");
    expect(cache.get("a", "accent")).toBeUndefined();
    expect(cache.get("b", "accent")).toBe(accent);
    expect(cache.get("c", "accent")).toBe(accent);
  });

  it("notifies active subscribers and removes unsubscribed listeners", async () => {
    const cache = createCoverToneCache(async () => ({ accent }));
    const notify = vi.fn();
    const stop = cache.subscribe(notify);
    await cache.load("a", "accent");
    expect(notify).toHaveBeenCalledTimes(1);
    stop();
    await cache.load("b", "accent");
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

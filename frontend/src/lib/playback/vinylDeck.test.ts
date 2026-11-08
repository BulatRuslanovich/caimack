// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("react", () => ({
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("@/lib/http", () => ({ API_BASE: "/api", fetchWithSession: vi.fn() }));
vi.mock("./equalizer", () => ({
  prepareVinylScratch: vi.fn().mockResolvedValue(true),
  loadVinylScratchTrack: vi.fn().mockReturnValue(true),
  unloadVinylScratchTrack: vi.fn(),
}));
import { fetchWithSession } from "@/lib/http";
import { loadVinylScratchTrack, unloadVinylScratchTrack } from "./equalizer";
import { decodeVinylTrack, prepareVinylDeck, releaseVinylDeck, useVinylDeck } from "./vinylDeck";

const decoded = () => ({
  duration: 10,
  numberOfChannels: 2,
  sampleRate: 24_000,
  getChannelData: () => new Float32Array([0.1, -0.2, 0.3]),
});
let decode: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  releaseVinylDeck();
  decode = vi.fn().mockResolvedValue(decoded());
  vi.stubGlobal(
    "OfflineAudioContext",
    vi.fn(function () {
      return { decodeAudioData: decode };
    }),
  );
  vi.mocked(fetchWithSession).mockImplementation(
    async () => new Response(new Uint8Array([1, 2, 3])),
  );
});
afterEach(() => vi.unstubAllGlobals());

it("fetches and decodes the actual track, loading only the current deck", async () => {
  await prepareVinylDeck("track", 180, new AbortController().signal);
  expect(fetchWithSession).toHaveBeenCalledWith(
    "/api/tracks/track/stream",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(loadVinylScratchTrack).toHaveBeenCalledWith("track", expect.any(Array), 24_000);
  expect(useVinylDeck("track")).toBe("ready");
  expect(useVinylDeck("other")).toBe("idle");
  releaseVinylDeck();
  expect(useVinylDeck("track")).toBe("idle");
  expect(unloadVinylScratchTrack).toHaveBeenCalled();
});

it("cannot install a stale track after another track takes over", async () => {
  let finish!: (audio: ReturnType<typeof decoded>) => void;
  decode.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = prepareVinylDeck("old", 180, new AbortController().signal);
  await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
  await prepareVinylDeck("new", 180, new AbortController().signal);
  finish(decoded());
  await first;
  expect(loadVinylScratchTrack).toHaveBeenCalledTimes(1);
  expect(loadVinylScratchTrack).toHaveBeenCalledWith("new", expect.any(Array), 24_000);
  expect(useVinylDeck("new")).toBe("ready");
});

it("discards a decode that completes after closing the player", async () => {
  let finish!: (audio: ReturnType<typeof decoded>) => void;
  decode.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const task = prepareVinylDeck("track", 180, controller.signal);
  await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
  controller.abort();
  releaseVinylDeck();
  finish(decoded());
  await task;
  expect(loadVinylScratchTrack).not.toHaveBeenCalled();
  expect(useVinylDeck("track")).toBe("idle");
});

it("rejects overlong tracks before downloading and oversized files before decoding", async () => {
  await expect(decodeVinylTrack("long", 601, new AbortController().signal)).rejects.toThrow();
  expect(fetchWithSession).not.toHaveBeenCalled();
  vi.mocked(fetchWithSession).mockResolvedValue(
    new Response(new Uint8Array([1]), { headers: { "Content-Length": String(49 * 1024 * 1024) } }),
  );
  await prepareVinylDeck("large", 180, new AbortController().signal);
  expect(decode).not.toHaveBeenCalled();
  expect(loadVinylScratchTrack).not.toHaveBeenCalled();
  expect(useVinylDeck("large")).toBe("unavailable");
});

it("reports unsupported codecs without interrupting the ordinary player", async () => {
  decode.mockRejectedValueOnce(new Error("Unsupported codec"));
  await prepareVinylDeck("track", 180, new AbortController().signal);
  expect(loadVinylScratchTrack).not.toHaveBeenCalled();
  expect(useVinylDeck("track")).toBe("unavailable");
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it, vi } from "vitest";
import { AdaptivePlayback, adaptiveWanted } from "@/lib/playback/adaptivePlayback";
import { fetchWithSession } from "@/lib/http";

vi.mock("@/lib/http", () => ({
  API_BASE: "/api",
  fetchWithSession: vi.fn(),
  refreshSession: vi.fn(),
}));
vi.mock("hls.js", () => ({
  default: class {
    static isSupported() {
      return false;
    }
    static DefaultConfig = { loader: class {} };
  },
}));

describe("adaptive playback selection", () => {
  const original = {
    quality: "Original",
    forceAdaptive: false,
  } as const;

  it("keeps the original on the progressive stream", () => {
    expect(adaptiveWanted(original)).toBe(false);
  });

  it("goes adaptive for quality tiers and degraded originals", () => {
    for (const quality of ["Low", "Normal"] as const) {
      expect(adaptiveWanted({ ...original, quality })).toBe(true);
    }

    expect(adaptiveWanted({ ...original, forceAdaptive: true })).toBe(true);
  });
});

describe("AdaptivePlayback source lifecycle", () => {
  function stubAudio() {
    (globalThis as { HTMLMediaElement?: unknown }).HTMLMediaElement ??= { HAVE_METADATA: 1 };

    return {
      dataset: {} as Record<string, string>,
      src: "",
      readyState: 0,
      currentTime: 0,
      paused: true,
      pause: vi.fn(),
      load: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      removeAttribute: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      canPlayType: vi.fn(() => ""),
    };
  }

  const request = {
    trackId: "11111111-1111-7111-8111-111111111111",
    quality: "Original" as const,
    forceAdaptive: false,
    startAt: 12,
    play: true,
  };

  it("does not touch the shared audio element", async () => {
    const audio = stubAudio();
    const playback = new AdaptivePlayback(audio as unknown as HTMLAudioElement, {
      onFatalError: () => {},
    });

    playback.destroy();
    await playback.load(request);

    expect(audio.pause).not.toHaveBeenCalled();
    expect(audio.load).not.toHaveBeenCalled();
    expect(audio.src).toBe("");
    expect(audio.dataset).toEqual({});
  });

  it("still settles, so callers can move on", async () => {
    const audio = stubAudio();
    const playback = new AdaptivePlayback(audio as unknown as HTMLAudioElement, {
      onFatalError: () => {},
    });

    playback.destroy();

    await expect(playback.load(request)).resolves.toBeUndefined();
  });

  it("loads normally until it is destroyed", async () => {
    const audio = stubAudio();
    const playback = new AdaptivePlayback(audio as unknown as HTMLAudioElement, {
      onFatalError: () => {},
    });

    await playback.load(request);

    expect(audio.pause).toHaveBeenCalled();
    expect(audio.src).toBe(`/api/tracks/${request.trackId}/stream`);
  });

  it("does not resume after the listener pauses while metadata is loading", async () => {
    const audio = stubAudio();
    const playback = new AdaptivePlayback(audio as unknown as HTMLAudioElement, {
      onFatalError: () => {},
    });
    await playback.load({ ...request });
    const metadata = audio.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "loadedmetadata",
    ) as unknown as [string, () => void];
    playback.setPlaying(false);
    metadata[1]();
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.dataset.sourceLoading).toBe("false");
  });

  it("removes a pending seek and autoplay callback when switching sources", async () => {
    const audio = stubAudio();
    const playback = new AdaptivePlayback(audio as unknown as HTMLAudioElement, {
      onFatalError: () => {},
    });
    await playback.load({ ...request });
    const metadata = audio.addEventListener.mock.calls.find(
      (call: unknown[]) => call[0] === "loadedmetadata",
    ) as unknown as [string, () => void];
    playback.destroy();
    expect(audio.removeEventListener).toHaveBeenCalledWith("loadedmetadata", metadata[1]);
  });

  it("reports a browser playback block when the current source starts after loading", async () => {
    const audio = stubAudio();
    const blocked = vi.fn();
    audio.play.mockRejectedValue(new DOMException("Playback blocked", "NotAllowedError"));
    const playback = new AdaptivePlayback(audio as unknown as HTMLAudioElement, {
      onFatalError: vi.fn(),
      onPlayBlocked: blocked,
    });

    await playback.load({ ...request });
    const metadata = audio.addEventListener.mock.calls[0] as unknown as [string, () => void];
    metadata[1]();
    await Promise.resolve();

    expect(blocked).toHaveBeenCalledOnce();
  });

  it("ignores a play rejection from a superseded load on the same element", async () => {
    const audio = stubAudio();
    audio.readyState = 1;
    const blocked = vi.fn();
    const firstPlay = Promise.withResolvers<void>();
    audio.play.mockReturnValueOnce(firstPlay.promise);
    const playback = new AdaptivePlayback(audio as unknown as HTMLAudioElement, {
      onFatalError: vi.fn(),
      onPlayBlocked: blocked,
    });

    await playback.load({ ...request });
    await playback.load({ ...request, trackId: "22222222-2222-7222-8222-222222222222" });
    firstPlay.reject(new DOMException("Playback blocked", "NotAllowedError"));
    await Promise.resolve();

    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(blocked).not.toHaveBeenCalled();
  });

  it("uses native HLS when the browser supports it and reports reduced Original honestly", async () => {
    vi.stubGlobal("window", globalThis);
    try {
      vi.mocked(fetchWithSession).mockResolvedValue(new Response("#EXTM3U", { status: 200 }));
      const audio = stubAudio();
      audio.canPlayType.mockReturnValue("probably");
      const playback = new AdaptivePlayback(audio as unknown as HTMLAudioElement, {
        onFatalError: () => {},
      });
      await playback.load({ ...request, forceAdaptive: true });
      expect(audio.src).toContain("/hls/master.m3u8");
      expect(audio.dataset.playbackMode).toBe("native-hls");
      expect(audio.dataset.streamReduced).toBe("true");
      playback.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps using the original if the server has not prepared AAC yet", async () => {
    vi.stubGlobal("window", globalThis);
    try {
      vi.mocked(fetchWithSession).mockResolvedValue(new Response(null, { status: 202 }));
      const audio = stubAudio();
      audio.canPlayType.mockReturnValue("probably");
      const playback = new AdaptivePlayback(audio as unknown as HTMLAudioElement, {
        onFatalError: () => {},
      });
      await playback.load({ ...request, forceAdaptive: true });
      expect(audio.src).toBe(`/api/tracks/${request.trackId}/stream`);
      expect(audio.dataset.streamReduced).toBe("false");
      playback.destroy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  CROSSFADE_PRELOAD_LEAD_SECONDS,
  Crossfade,
  crossfadeSeconds,
  crossfadeStage,
  fadeGains,
} from "@/lib/playback/crossfade";

function track(id: string, durationSeconds = 240) {
  return { id, durationSeconds };
}

function planned(overrides: Partial<Parameters<typeof crossfadeSeconds>[0]> = {}) {
  return crossfadeSeconds({
    setting: 5,
    repeat: "off",
    current: track("a"),
    currentDuration: 240,
    next: track("b"),
    ...overrides,
  });
}

class FakeAudio {
  volume = 1;
  currentTime = 0;
  ended = false;
  paused = false;
  plays = 0;

  play() {
    this.plays += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }
}

describe("crossfadeSeconds", () => {
  it("is zero when crossfade is off", () => {
    expect(planned({ setting: 0 })).toBe(0);
  });

  it("uses the chosen length for ordinary tracks", () => {
    expect(planned()).toBe(5);
    expect(planned({ setting: 8 })).toBe(8);
  });

  it("is zero on repeat-one, which replays the same track", () => {
    expect(planned({ repeat: "one" })).toBe(0);
  });

  it("still fades on repeat-all into the wrapped-around track", () => {
    expect(planned({ repeat: "all", next: track("first") })).toBe(5);
  });

  it("is zero when nothing follows: last track or an empty queue", () => {
    expect(planned({ next: null })).toBe(0);
  });

  it("is zero when the next entry is the same track, as in a one-track repeat-all queue", () => {
    expect(planned({ next: track("a") })).toBe(0);
  });

  it("shrinks to half of a short track so the fade never covers it whole", () => {
    expect(planned({ currentDuration: 6 })).toBe(3);
    expect(planned({ next: track("b", 4) })).toBe(2);
  });

  it("gives up on tracks too short to blend", () => {
    expect(planned({ currentDuration: 1.5 })).toBe(0);
    expect(planned({ next: track("b", 0) })).toBe(0);
  });
});

describe("crossfadeStage", () => {
  it("starts preloading the lead time before the fade and fading exactly at its window", () => {
    expect(crossfadeStage(5 + CROSSFADE_PRELOAD_LEAD_SECONDS + 0.1, 5)).toBe("wait");
    expect(crossfadeStage(5 + CROSSFADE_PRELOAD_LEAD_SECONDS, 5)).toBe("preload");
    expect(crossfadeStage(5.1, 5)).toBe("preload");
    expect(crossfadeStage(5, 5)).toBe("fade");
    expect(crossfadeStage(0.2, 5)).toBe("fade");
  });

  it("waits when crossfade is off or the track is already over", () => {
    expect(crossfadeStage(3, 0)).toBe("wait");
    expect(crossfadeStage(0, 5)).toBe("wait");
  });
});

describe("fadeGains", () => {
  it("moves from the outgoing track to the incoming one", () => {
    expect(fadeGains(0)).toEqual({ outgoing: 1, incoming: 0 });
    expect(fadeGains(1).outgoing).toBeCloseTo(0);
    expect(fadeGains(1).incoming).toBeCloseTo(1);
  });

  it("keeps constant power so the middle does not dip", () => {
    for (const progress of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const { outgoing, incoming } = fadeGains(progress);
      expect(outgoing ** 2 + incoming ** 2).toBeCloseTo(1);
    }
  });

  it("clamps progress outside the fade", () => {
    expect(fadeGains(-1)).toEqual(fadeGains(0));
    expect(fadeGains(2)).toEqual(fadeGains(1));
  });
});

describe("Crossfade", () => {
  let outgoing: FakeAudio;
  let incoming: FakeAudio;
  let release: Mock<() => void>;
  let fade: Crossfade;

  beforeEach(() => {
    vi.useFakeTimers();
    outgoing = new FakeAudio();
    incoming = new FakeAudio();
    release = vi.fn<() => void>();
    fade = new Crossfade();
  });

  afterEach(() => {
    fade.finish();
    vi.useRealTimers();
  });

  function at(seconds: number) {
    incoming.currentTime = seconds;
    fade.tick();
  }

  it("starts with the outgoing track at the listener's volume and the incoming one silent", () => {
    fade.setLevel(0.35);
    fade.start(outgoing, incoming, 5, release);

    expect(fade.active).toBe(true);
    expect(outgoing.volume).toBeCloseTo(0.35);
    expect(incoming.volume).toBe(0);
  });

  it("lowers the outgoing track while raising the incoming one", () => {
    fade.start(outgoing, incoming, 5, release);

    const samples = [1, 2, 3, 4].map((second) => {
      at(second);
      return { out: outgoing.volume, in: incoming.volume };
    });

    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i].out).toBeLessThan(samples[i - 1].out);
      expect(samples[i].in).toBeGreaterThan(samples[i - 1].in);
    }
  });

  it("never goes above the listener's volume", () => {
    fade.setLevel(0.35);
    fade.start(outgoing, incoming, 5, release);

    for (const second of [0.5, 1.5, 2.5, 3.5, 4.5]) {
      at(second);
      expect(outgoing.volume).toBeLessThanOrEqual(0.35);
      expect(incoming.volume).toBeLessThanOrEqual(0.35);
    }

    at(5);
    expect(incoming.volume).toBe(0.35);
  });

  it("follows a volume change made mid-fade", () => {
    fade.start(outgoing, incoming, 4, release);
    at(2);

    fade.setLevel(0.5);

    expect(outgoing.volume).toBeCloseTo(0.5 * Math.SQRT1_2);
    expect(incoming.volume).toBeCloseTo(0.5 * Math.SQRT1_2);
  });

  it("measures progress from where the incoming track started", () => {
    incoming.currentTime = 10;
    fade.start(outgoing, incoming, 4, release);

    at(12);

    expect(incoming.volume).toBeCloseTo(Math.SQRT1_2);
  });

  it("drives itself on a timer without waiting for real seconds", () => {
    fade.start(outgoing, incoming, 5, release);

    incoming.currentTime = 2.5;
    vi.advanceTimersByTime(60);

    expect(incoming.volume).toBeCloseTo(Math.SQRT1_2);
  });

  it("stops and releases the outgoing track once the fade is through", () => {
    fade.setLevel(0.6);
    fade.start(outgoing, incoming, 5, release);

    at(5);

    expect(fade.active).toBe(false);
    expect(outgoing.paused).toBe(true);
    expect(release).toHaveBeenCalledOnce();
    expect(incoming.volume).toBe(0.6);
    expect(vi.getTimerCount()).toBe(0);

    fade.finish();
    fade.tick();
    expect(release).toHaveBeenCalledOnce();
  });

  it("ends early when the outgoing track runs out first", () => {
    fade.start(outgoing, incoming, 5, release);

    outgoing.ended = true;
    at(3);

    expect(fade.active).toBe(false);
    expect(release).toHaveBeenCalledOnce();
    expect(incoming.volume).toBe(1);
  });

  it("cuts straight to the incoming track on finish, as Next or a seek mid-fade do", () => {
    fade.start(outgoing, incoming, 5, release);
    at(1);

    fade.finish();

    expect(outgoing.paused).toBe(true);
    expect(release).toHaveBeenCalledOnce();
    expect(incoming.volume).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases a running fade before starting another, so old tracks never pile up", () => {
    const first = vi.fn();
    fade.start(outgoing, incoming, 5, first);

    const later = new FakeAudio();
    fade.start(incoming, later, 5, release);

    expect(first).toHaveBeenCalledOnce();
    expect(outgoing.paused).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("pauses the outgoing track with playback and resumes it after", () => {
    fade.start(outgoing, incoming, 5, release);
    at(2);
    const volumeAtPause = outgoing.volume;

    fade.pause();

    expect(outgoing.paused).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(fade.active).toBe(true);

    fade.resume();

    expect(outgoing.paused).toBe(false);
    expect(outgoing.volume).toBe(volumeAtPause);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does not restart an outgoing track that already ended", () => {
    fade.start(outgoing, incoming, 5, release);
    fade.pause();

    outgoing.ended = true;
    fade.resume();

    expect(outgoing.plays).toBe(0);
  });

  it("keeps a single timer however often resume is called", () => {
    fade.start(outgoing, incoming, 5, release);
    fade.resume();
    fade.resume();

    expect(vi.getTimerCount()).toBe(1);
  });

  it("fades each track towards its own normalised level", () => {
    fade.setLevel(0.8);
    fade.setGain(outgoing, 0.5);
    fade.setGain(incoming, 0.25);
    fade.start(outgoing, incoming, 5, release);

    expect(outgoing.volume).toBeCloseTo(0.4);
    at(5);
    expect(incoming.volume).toBeCloseTo(0.2);
    expect(fade.levelFor(incoming)).toBeCloseTo(0.2);
  });

  it("does nothing when no fade is running", () => {
    fade.setLevel(0.4);
    fade.pause();
    fade.resume();
    fade.tick();
    fade.finish();

    expect(fade.active).toBe(false);
    expect(fade.level).toBe(0.4);
    expect(vi.getTimerCount()).toBe(0);
  });
});

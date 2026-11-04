// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { SLEEP_FADE_SECONDS, sleepGain, sleepTimerFor } from "@/lib/playback/useSleepTimer";

describe("sleepGain", () => {
  it("keeps full volume until the fade begins", () => {
    expect(sleepGain(SLEEP_FADE_SECONDS + 60)).toBe(1);
    expect(sleepGain(SLEEP_FADE_SECONDS)).toBe(1);
  });

  it("fades down to silence over the last seconds", () => {
    expect(sleepGain(SLEEP_FADE_SECONDS / 2)).toBeCloseTo(0.5);
    expect(sleepGain(0)).toBe(0);
    expect(sleepGain(-3)).toBe(0);
  });
});

describe("sleepTimerFor", () => {
  it("counts minutes from now", () => {
    expect(sleepTimerFor(30, 1_000)).toEqual({
      kind: "minutes",
      minutes: 30,
      endsAt: 1_000 + 30 * 60_000,
    });
  });

  it("waits for the end of the track or turns off", () => {
    expect(sleepTimerFor("trackEnd", 0)).toEqual({ kind: "trackEnd" });
    expect(sleepTimerFor(null, 0)).toBeNull();
  });
});

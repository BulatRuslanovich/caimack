// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { bandBins, bandLevel, beatPulse, follow, onset } from "@/lib/playback/spectrum";

describe("bandBins", () => {
  it("cuts the spectrum into contiguous log-spaced bands", () => {
    const bands = bandBins(24, 48_000, 2048);

    expect(bands).toHaveLength(24);
    bands.forEach(([from, to]) => expect(to).toBeGreaterThan(from));
    expect(bands[0][1] - bands[0][0]).toBeLessThan(bands[23][1] - bands[23][0]);
    expect(bands[23][1]).toBeLessThanOrEqual(1023);
  });
});

describe("bandLevel", () => {
  it("is silent for silence and full for a full band", () => {
    expect(bandLevel(new Uint8Array(16), [2, 6])).toBe(0);
    expect(bandLevel(new Uint8Array(16).fill(255), [2, 6])).toBe(1);
  });

  it("presses quiet bands down harder than loud ones", () => {
    expect(bandLevel(new Uint8Array(16).fill(128), [0, 4])).toBeLessThan(0.5);
  });
});

describe("follow", () => {
  it("rises faster than it falls", () => {
    expect(follow(0, 1) - 0).toBeGreaterThan(1 - follow(1, 0));
  });
});

describe("beatPulse", () => {
  it("flashes on the beat and fades before the next one", () => {
    expect(beatPulse(0, 120)).toBeCloseTo(1);
    expect(beatPulse(0.5, 120)).toBeCloseTo(1);
    expect(beatPulse(0.4, 120)).toBeLessThan(0.05);
    expect(beatPulse(10, 0)).toBe(0);
  });
});

describe("onset", () => {
  it("fires only when the bass jumps above its running level", () => {
    expect(onset(0.5, 0.5)).toBe(0);
    expect(onset(0.8, 0.5)).toBeGreaterThan(0.5);
  });
});

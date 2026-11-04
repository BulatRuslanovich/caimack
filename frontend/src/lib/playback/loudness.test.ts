// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { NORMALIZE_TARGET_LUFS, normalizationGain } from "@/lib/playback/loudness";

const measured = (lufs: number) => ({ loudness: { lufs, truePeak: -1 } });

describe("normalizationGain", () => {
  it("turns a loud master down to the target", () => {
    expect(normalizationGain(measured(NORMALIZE_TARGET_LUFS + 6), true)).toBeCloseTo(0.501, 3);
  });

  it("never turns a quiet track up", () => {
    expect(normalizationGain(measured(NORMALIZE_TARGET_LUFS - 6), true)).toBe(1);
  });

  it("leaves the track alone when switched off or not measured", () => {
    expect(normalizationGain(measured(-6), false)).toBe(1);
    expect(normalizationGain({ loudness: null }, true)).toBe(1);
    expect(normalizationGain(null, true)).toBe(1);
  });
});

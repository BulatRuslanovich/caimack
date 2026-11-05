// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { EQ_BANDS, EQ_PRESETS, equalizerState, effectivePreamp } from "./equalizer-model";

describe("equalizer settings", () => {
  it("migrates five-band settings along the logarithmic frequency scale", () => {
    const state = equalizerState({ enabled: true, gains: [6, 4, 0, -3, -6] });
    expect(state.enabled).toBe(true);
    expect(state.gains).toEqual([6, 6, 5, 4, 2, 0, -2, -3, -5, -6]);
    expect(state.preampDb).toBe(0);
    expect(state.autoHeadroom).toBe(true);
  });

  it("rejects malformed settings and clamps every saved gain", () => {
    expect(equalizerState(null).gains).toEqual(EQ_PRESETS.flat);
    const state = equalizerState({
      enabled: "yes",
      gains: [99, -99, NaN, Infinity, "4", 1.8, 0, 0, 0, 0],
      preampDb: 99,
    });
    expect(state.enabled).toBe(false);
    expect(state.gains).toEqual([12, -12, 0, 0, 0, 2, 0, 0, 0, 0]);
    expect(state.preampDb).toBe(12);
    expect(equalizerState({ gains: { 0: 8 } }).gains).toEqual(EQ_PRESETS.flat);
  });

  it("reserves headroom while respecting a lower manual preamp", () => {
    const state = equalizerState({ enabled: true, gains: EQ_PRESETS.bass, preampDb: 3 });
    expect(effectivePreamp(state)).toBe(-6);
    expect(effectivePreamp({ ...state, preampDb: -9 })).toBe(-9);
    expect(effectivePreamp({ ...state, autoHeadroom: false })).toBe(3);
    expect(effectivePreamp({ ...state, enabled: false })).toBe(0);
  });

  it("provides ten independent bands in every preset", () => {
    expect(EQ_BANDS).toHaveLength(10);
    for (const gains of Object.values(EQ_PRESETS)) expect(gains).toHaveLength(10);
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { coverTone, TONE_SAMPLE_EDGE } from "@/lib/coverTone";

type Rgba = [number, number, number, number];

function image(first: Rgba, second: Rgba = first, share = 1): number[] {
  const size = TONE_SAMPLE_EDGE * TONE_SAMPLE_EDGE;
  const split = Math.round(size * share);
  return Array.from({ length: size }, (_, i) => (i < split ? first : second)).flat();
}

describe("coverTone", () => {
  it("takes the hue and chroma of a flat colour", () => {
    expect(coverTone(image([217, 164, 65, 255]))).toEqual({ hue: 79.8, chroma: 0.13 });
    expect(coverTone(image([40, 90, 200, 255]))).toEqual({ hue: 263.1, chroma: 0.18 });
  });

  it("lets the dominant colour win", () => {
    expect(coverTone(image([200, 60, 60, 255], [60, 160, 90, 255], 0.7))).toEqual({
      hue: 24.9,
      chroma: 0.177,
    });
  });

  it("ignores near-black and grey around a small colourful patch", () => {
    expect(coverTone(image([230, 120, 150, 255], [10, 10, 10, 255], 0.3))).toEqual({
      hue: 3.9,
      chroma: 0.139,
    });
  });

  it("calls black-and-white covers neutral", () => {
    expect(coverTone(image([240, 240, 240, 255], [20, 20, 20, 255], 0.5))).toBeNull();
    expect(coverTone(image([128, 120, 116, 255]))).toBeNull();
  });

  it("skips transparent pixels", () => {
    expect(coverTone(image([0, 0, 0, 0]))).toBeNull();
    expect(coverTone(image([40, 90, 200, 255], [255, 0, 0, 0], 0.5))).toEqual({
      hue: 263.1,
      chroma: 0.18,
    });
  });
});

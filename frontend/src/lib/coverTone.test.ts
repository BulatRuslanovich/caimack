// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { backdropTone, coverTone, TONE_SAMPLE_EDGE } from "@/lib/coverTone";

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

describe("backdropTone", () => {
  it("finds cool muted highlights on a mostly dark photographic cover", () => {
    const pixels = image([170, 185, 205, 255], [23, 22, 17, 255], 0.25);
    expect(coverTone(pixels)).toBeNull();
    const backdrop = backdropTone(pixels)!;
    expect(backdrop.hue).toBeGreaterThan(230);
    expect(backdrop.hue).toBeLessThan(275);
    expect(backdrop.chroma).toBeGreaterThan(0.02);
  });

  it("chooses the larger muted colour field over a smaller saturated accent", () => {
    const pixels = image([110, 170, 135, 255], [205, 20, 170, 255], 0.6);
    const backdrop = backdropTone(pixels)!;
    expect(backdrop.hue).toBeGreaterThan(140);
    expect(backdrop.hue).toBeLessThan(175);
    expect(coverTone(pixels)!.hue).toBeGreaterThan(300);
  });

  it("groups neighbouring shades when choosing the dominant colour family", () => {
    const pixels = [
      ...image([90, 170, 125, 255]).slice(0, 400),
      ...image([80, 165, 155, 255]).slice(0, 400),
      ...image([205, 20, 170, 255]).slice(0, 600),
    ];
    expect(backdropTone(pixels)!.hue).toBeGreaterThan(140);
    expect(backdropTone(pixels)!.hue).toBeLessThan(200);
  });

  it("keeps black-and-white, empty and transparent covers neutral", () => {
    for (const pixels of [
      [],
      image([240, 240, 240, 255], [20, 20, 20, 255], 0.5),
      image([128, 120, 116, 255]),
      image([255, 0, 0, 0]),
    ]) {
      expect(backdropTone(pixels)).toBeNull();
    }
  });

  it("preserves the colour of a single-colour cover and ignores transparency", () => {
    const pixels = image([40, 90, 200, 255], [255, 0, 0, 0], 0.5);
    expect(Math.abs(backdropTone(pixels)!.hue - coverTone(pixels)!.hue)).toBeLessThan(10);
    expect(backdropTone(pixels)!.chroma).toBeCloseTo(coverTone(pixels)!.chroma, 2);
  });

  it("preserves the difference between a dark blue cover and a bright blue cover", () => {
    const dark = backdropTone(image([18, 24, 68, 255]))!;
    const bright = backdropTone(image([115, 150, 220, 255]))!;
    expect(dark.lightness).toBeLessThan(0.3);
    expect(bright.lightness).toBeGreaterThan(0.6);
    expect(dark.chroma).toBeGreaterThan(0.04);
  });
});

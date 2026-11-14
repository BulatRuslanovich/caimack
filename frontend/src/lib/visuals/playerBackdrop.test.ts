// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  backdropRgb,
  coverPalette,
  playerBackdropSurface,
  playerBackdropTone,
} from "./playerBackdrop";

const blocks = (...colors: [number, number, number, number][]) =>
  colors.flatMap(([r, g, b, count]) => Array.from({ length: count }, () => [r, g, b, 255]).flat());
const luminance = (rgb: number[]) =>
  rgb
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);

describe("full player background", () => {
  it("selects a substantial colour instead of the black majority or white highlights", () => {
    const tone = playerBackdropTone(
      blocks([12, 12, 12, 700], [235, 235, 235, 100], [210, 110, 40, 200]),
    )!;
    expect(tone.hue).toBeGreaterThan(30);
    expect(tone.hue).toBeLessThan(80);
  });

  it("lets a larger muted field beat a smaller vivid accent", () => {
    const tone = playerBackdropTone(
      blocks([130, 190, 150, 600], [200, 30, 170, 250], [10, 10, 10, 150]),
    )!;
    expect(tone.hue).toBeGreaterThan(130);
    expect(tone.hue).toBeLessThan(180);
  });

  it("does not promote tiny colourful noise on monochrome art", () => {
    expect(playerBackdropTone(blocks([80, 80, 80, 990], [255, 0, 0, 10]))).toBeNull();
    for (const pixels of [
      [],
      [255, 0, 0, 0],
      blocks([245, 245, 245, 500], [10, 10, 10, 500]),
      blocks([128, 120, 116, 1000]),
    ]) {
      expect(playerBackdropTone(pixels)).toBeNull();
    }
    expect(backdropRgb(playerBackdropSurface(null).top)).toEqual([82, 82, 82]);
  });

  it("keeps a very dark chromatic cover dark with a nearly flat gradient", () => {
    const surface = playerBackdropSurface(
      playerBackdropTone(blocks([7, 8, 36, 800], [245, 245, 245, 200])),
    );
    expect(surface.top.lightness).toBe(0.28);
    expect(surface.bottom).toEqual(surface.top);
    expect(surface.top.chroma).toBeGreaterThan(0.04);
  });

  it("is deterministic when pixel traversal order changes", () => {
    const colors: [number, number, number, number][] = [
      [130, 190, 150, 250],
      [200, 30, 170, 250],
      [10, 10, 10, 250],
      [220, 220, 220, 250],
    ];
    expect(coverPalette(blocks(...colors))).toEqual(coverPalette(blocks(...colors.reverse())));
  });

  it("keeps secondary text above 4.5:1 and all hues within the RGB gamut", () => {
    for (let hue = 0; hue < 360; hue += 10)
      for (const lightness of [0.15, 0.4, 0.9])
        for (const chroma of [0.03, 0.1, 0.3]) {
          const surface = playerBackdropSurface({ hue, lightness, chroma });
          for (const color of [surface.top, surface.bottom]) {
            const rgb = backdropRgb(color);
            expect(rgb.every((c) => Number.isFinite(c) && c >= 0 && c <= 255)).toBe(true);
            expect(
              (luminance([214, 214, 214]) + 0.05) / (luminance(rgb) + 0.05),
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
  });
});

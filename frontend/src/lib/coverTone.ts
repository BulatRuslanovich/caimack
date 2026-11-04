// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

export type CoverTone = { hue: number; chroma: number };

export const TONE_SAMPLE_EDGE = 24;

const HUE_BINS = 12;
const MIN_ALPHA = 128;
const MIN_LIGHTNESS = 0.12;
const MAX_LIGHTNESS = 0.97;
const GREY_CHROMA = 0.02;
const NEUTRAL_CHROMA = 0.025;
const MAX_CHROMA = 0.3;

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function oklab(r: number, g: number, b: number): [number, number, number] {
  const lr = linear(r);
  const lg = linear(g);
  const lb = linear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function coverTone(pixels: ArrayLike<number>): CoverTone | null {
  const weight = new Float64Array(HUE_BINS);
  const sumA = new Float64Array(HUE_BINS);
  const sumB = new Float64Array(HUE_BINS);
  const count = new Float64Array(HUE_BINS);
  let opaque = 0;
  let total = 0;

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < MIN_ALPHA) continue;
    opaque++;

    const [l, a, b] = oklab(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) continue;

    const chroma = Math.hypot(a, b);
    if (chroma < GREY_CHROMA) continue;

    const hue = (Math.atan2(b, a) * 180) / Math.PI + 360;
    const bin = Math.floor(hue / (360 / HUE_BINS)) % HUE_BINS;
    weight[bin] += chroma;
    sumA[bin] += a * chroma;
    sumB[bin] += b * chroma;
    count[bin]++;
    total += chroma;
  }

  if (opaque === 0 || total / opaque < NEUTRAL_CHROMA) return null;

  let top = 0;
  for (let bin = 1; bin < HUE_BINS; bin++) if (weight[bin] > weight[top]) top = bin;

  let a = 0;
  let b = 0;
  let chromaSum = 0;
  let pixelsInTop = 0;
  for (const offset of [-1, 0, 1]) {
    const bin = (top + offset + HUE_BINS) % HUE_BINS;
    a += sumA[bin];
    b += sumB[bin];
    chromaSum += weight[bin];
    pixelsInTop += count[bin];
  }

  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const chroma = Math.min(MAX_CHROMA, chromaSum / pixelsInTop);

  return { hue: Math.round(hue * 10) / 10, chroma: Math.round(chroma * 1000) / 1000 };
}

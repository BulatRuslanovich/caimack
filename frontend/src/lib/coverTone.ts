// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

export type CoverTone = { hue: number; chroma: number };
export type BackdropTone = CoverTone & { lightness: number };

export const TONE_SAMPLE_EDGE = 24;
export const BACKDROP_SAMPLE_EDGE = 64;

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

export function backdropTone(pixels: ArrayLike<number>): BackdropTone | null {
  const createBins = () =>
    Array.from({ length: HUE_BINS }, () => ({ count: 0, a: 0, b: 0, chroma: 0, lightness: 0 }));
  const vividBins = createBins();
  const mutedBins = createBins();
  const samples: {
    lightness: number;
    a: number;
    b: number;
    chroma: number;
    hue: number;
    red: number;
    green: number;
    blue: number;
  }[] = [];
  let opaque = 0;
  let chromaTotal = 0;

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < MIN_ALPHA) continue;
    opaque++;
    const [lightness, a, b] = oklab(pixels[i], pixels[i + 1], pixels[i + 2]);
    const chroma = Math.hypot(a, b);
    const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    const index = Math.floor(hue / (360 / HUE_BINS));
    if (lightness >= 0.12 && lightness <= 0.94 && chroma >= 0.008) {
      samples.push({
        lightness,
        a,
        b,
        chroma,
        hue,
        red: pixels[i],
        green: pixels[i + 1],
        blue: pixels[i + 2],
      });
    }

    // Muted highlights still carry a useful colour on dark photographic covers.
    // Keep them separate from the coloured shadows that fill most of the image.
    if (lightness >= 0.35 && lightness <= 0.92 && chroma >= 0.008 && chroma <= 0.08) {
      const muted = mutedBins[index];
      muted.count++;
      muted.a += a;
      muted.b += b;
      muted.chroma += chroma;
      muted.lightness += lightness;
    }
    if (lightness < MIN_LIGHTNESS || lightness > MAX_LIGHTNESS || chroma < GREY_CHROMA) continue;

    const bin = vividBins[index];
    bin.count++;
    bin.a += a;
    bin.b += b;
    bin.chroma += chroma;
    bin.lightness += lightness;
    chromaTotal += chroma;
  }

  if (!opaque) return null;
  const vivid = chromaTotal / opaque >= NEUTRAL_CHROMA;
  const bins = vivid ? vividBins : mutedBins;

  // Large colour families make a calmer backdrop than small saturated accents.
  // Neighbouring bins share their votes so a family split at a bin edge still wins.
  const population = (index: number) =>
    bins[index].count +
    (bins[(index + HUE_BINS - 1) % HUE_BINS].count + bins[(index + 1) % HUE_BINS].count) * 0.5;
  let top = 0;
  for (let index = 1; index < HUE_BINS; index++)
    if (population(index) > population(top)) top = index;

  let a = 0;
  let b = 0;
  let chroma = 0;
  let count = 0;
  let lightness = 0;
  for (const offset of [-1, 0, 1]) {
    const bin = bins[(top + offset + HUE_BINS) % HUE_BINS];
    const weight = offset === 0 ? 1 : 0.5;
    a += bin.a * weight;
    b += bin.b * weight;
    chroma += bin.chroma * weight;
    count += bin.count * weight;
    lightness += bin.lightness * weight;
  }

  if (!count || (!vivid && chroma / count < GREY_CHROMA)) return null;

  const baseHue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const baseChroma = chroma / count;
  const baseLightness = lightness / count;
  const family = samples
    .filter((sample) => Math.abs(((sample.hue - baseHue + 540) % 360) - 180) <= 30)
    .sort((first, second) => second.chroma - first.chroma);
  const share = Math.max(0.1, Math.min(0.25, family.length / opaque - 0.15));
  const swatch = family.slice(0, Math.max(1, Math.ceil(family.length * share)));
  if (!swatch.length) return null;

  let red = 0,
    green = 0,
    blue = 0;
  a = b = lightness = 0;
  for (const sample of swatch) {
    red += sample.red;
    green += sample.green;
    blue += sample.blue;
    a += sample.a;
    b += sample.b;
    lightness += sample.lightness;
  }

  // Pick a chromatic swatch inside the dominant family instead of averaging
  // its colour with white highlights. RGB contrast keeps the darker palette
  // from turning bright blues cyan and oranges muddy.
  const contrast = (channel: number) => (channel / swatch.length / 255) ** 2.2 * 255;
  const [, contrastA, contrastB] = oklab(contrast(red), contrast(green), contrast(blue));
  const swatchHue = ((Math.atan2(contrastB, contrastA) * 180) / Math.PI + 360) % 360;
  const muted = baseChroma < 0.05;
  const hue = baseHue + (((swatchHue - baseHue + 540) % 360) - 180) * (muted ? 0.35 : 1);
  const swatchChroma = Math.hypot(a, b) / swatch.length;

  return {
    hue: Math.round(((hue + 360) % 360) * 10) / 10,
    chroma:
      Math.round(
        Math.min(MAX_CHROMA, muted ? swatchChroma * 0.65 + baseChroma * 0.35 : swatchChroma) * 1000,
      ) / 1000,
    lightness: Math.round(((lightness / swatch.length) * 0.9 + baseLightness * 0.1) * 1000) / 1000,
  };
}

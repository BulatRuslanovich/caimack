// SPDX-License-Identifier: AGPL-3.0-only

import { oklab, type BackdropTone } from "../coverTone";

// Empirical approximation of the observed desktop player, not Spotify internals.
// Keep these values in sync with Android's PlayerBackdropSettings.
export const PLAYER_BACKDROP = {
  sampleEdge: 64,
  clusters: 12,
  iterations: 12,
  quantizationBits: 4,
  minimumAlpha: 128,
  minimumShare: 0.015,
  minimumLightness: 0.12,
  maximumLightness: 0.94,
  minimumChroma: 0.02,
  saturationWeight: 0.25,
  lightnessWeight: 0.2,
  preferredLightness: 0.55,
  hueContrast: 1.35,
  familyHueRadius: 25,
  familyChromaRatio: 0.75,
  surfaceMinimum: 0.28,
  surfaceMaximum: 0.44,
  neutralLightness: 0.44,
  gradientDrop: 0.09,
  chromaGain: 1.6,
  chromaSlope: 9,
  minimumChromaGain: 0.72,
  maximumChromaGain: 1.5,
  gamutSafety: 0.96,
  transitionMs: 900,
  loadTimeoutMs: 8000,
} as const;

type Triple = [number, number, number];
export type CoverSwatch = BackdropTone & { rgb: Triple; share: number };
const distance = (a: Triple, b: Triple) => a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Bounded, deterministic, population-weighted k-means in perceptual OKLab. */
export function coverPalette(pixels: ArrayLike<number>): CoverSwatch[] {
  const bins = new Map<number, { rgb: Triple; count: number }>();
  let count = 0;
  const shift = 8 - PLAYER_BACKDROP.quantizationBits;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < PLAYER_BACKDROP.minimumAlpha) continue;
    const rgb: Triple = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const key =
      ((rgb[0] >> shift) << (PLAYER_BACKDROP.quantizationBits * 2)) |
      ((rgb[1] >> shift) << PLAYER_BACKDROP.quantizationBits) |
      (rgb[2] >> shift);
    const bin = bins.get(key) ?? { rgb: [0, 0, 0], count: 0 };
    bin.count++;
    rgb.forEach((v, j) => (bin.rgb[j] += v));
    bins.set(key, bin);
    count++;
  }
  const points = [...bins.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, bin]) => {
      const rgb = bin.rgb.map((v) => v / bin.count) as Triple;
      return { rgb, lab: oklab(...rgb), count: bin.count };
    })
    .sort((a, b) => b.count - a.count);
  if (!points.length) return [];
  const centers: Triple[] = [points[0].lab];
  while (centers.length < Math.min(PLAYER_BACKDROP.clusters, points.length)) {
    let best = points[0],
      score = 0;
    for (const point of points) {
      const candidate =
        Math.min(...centers.map((c) => distance(point.lab, c))) * Math.sqrt(point.count);
      if (candidate > score) {
        best = point;
        score = candidate;
      }
    }
    if (score < 1e-10) break;
    centers.push(best.lab);
  }
  let buckets: { rgb: Triple; lab: Triple; count: number }[] = [];
  for (let iteration = 0; iteration < PLAYER_BACKDROP.iterations; iteration++) {
    buckets = centers.map(() => ({ rgb: [0, 0, 0], lab: [0, 0, 0], count: 0 }));
    for (const point of points) {
      let at = 0,
        closest = Infinity;
      centers.forEach((center, i) => {
        const delta = distance(point.lab, center);
        if (delta < closest) {
          closest = delta;
          at = i;
        }
      });
      const bucket = buckets[at];
      bucket.count += point.count;
      point.rgb.forEach((v, j) => (bucket.rgb[j] += v * point.count));
      point.lab.forEach((v, j) => (bucket.lab[j] += v * point.count));
    }
    buckets.forEach((bucket, i) => {
      if (bucket.count) centers[i] = bucket.lab.map((v) => v / bucket.count) as Triple;
    });
  }
  return buckets
    .filter((b) => b.count)
    .map((b) => {
      const rgb = b.rgb.map((v) => v / b.count) as Triple;
      const [lightness, a, blue] = oklab(...rgb);
      return {
        rgb,
        share: b.count / count,
        lightness,
        chroma: Math.hypot(a, blue),
        hue: ((Math.atan2(blue, a) * 180) / Math.PI + 360) % 360,
      };
    })
    .sort((a, b) => b.share - a.share);
}

export function selectPlayerTone(palette: CoverSwatch[]): BackdropTone | null {
  const s = PLAYER_BACKDROP;
  let selected: CoverSwatch | null = null,
    bestScore = 0;
  for (const swatch of palette) {
    if (
      swatch.share < s.minimumShare ||
      swatch.lightness < s.minimumLightness ||
      swatch.lightness > s.maximumLightness ||
      swatch.chroma < s.minimumChroma
    )
      continue;
    const saturation = Math.min(swatch.chroma / 0.2, 1);
    const lightness = 1 - Math.abs(swatch.lightness - s.preferredLightness) / s.preferredLightness;
    const score =
      swatch.share *
      (1 - s.saturationWeight + s.saturationWeight * saturation) *
      (1 - s.lightnessWeight + s.lightnessWeight * lightness);
    if (score > bestScore) {
      selected = swatch;
      bestScore = score;
    }
  }
  if (!selected) return null;
  // Adjacent shades can land in different clusters after thumbnail resampling.
  // Merge only similarly chromatic neighbours; don't dilute a vivid field with grey.
  const family = palette.filter(
    (swatch) =>
      swatch.chroma >= selected.chroma * s.familyChromaRatio &&
      Math.abs(((swatch.hue - selected.hue + 540) % 360) - 180) <= s.familyHueRadius,
  );
  const share = family.reduce((sum, swatch) => sum + swatch.share, 0);
  const representative = [0, 1, 2].map(
    (channel) =>
      family.reduce((sum, swatch) => sum + swatch.rgb[channel] * swatch.share, 0) / share,
  ) as Triple;
  const chroma = family.reduce((sum, swatch) => sum + swatch.chroma * swatch.share, 0) / share;
  // Gentle RGB contrast refines hue without averaging it with white highlights.
  const rgb = representative.map((v) => (v / 255) ** s.hueContrast * 255) as Triple;
  const [, a, b] = oklab(...rgb);
  return {
    lightness: selected.lightness,
    chroma,
    hue: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
  };
}

export function playerBackdropTone(pixels: ArrayLike<number>): BackdropTone | null {
  return selectPlayerTone(coverPalette(pixels));
}

function linearRgb({ lightness: l, chroma: c, hue }: BackdropTone): Triple {
  const a = c * Math.cos((hue * Math.PI) / 180),
    b = c * Math.sin((hue * Math.PI) / 180);
  const x = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const y = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const z = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * x - 3.3077115913 * y + 0.2309699292 * z,
    -1.2684380046 * x + 2.6097574011 * y - 0.3413193965 * z,
    -0.0041960863 * x - 0.7034186147 * y + 1.707614701 * z,
  ];
}

function gamutChroma(tone: BackdropTone): number {
  if (linearRgb(tone).every((c) => c >= 0 && c <= 1)) return tone.chroma;
  let low = 0,
    high = tone.chroma;
  for (let i = 0; i < 16; i++) {
    const chroma = (low + high) / 2;
    if (linearRgb({ ...tone, chroma }).every((c) => c >= 0 && c <= 1)) low = chroma;
    else high = chroma;
  }
  return low * PLAYER_BACKDROP.gamutSafety;
}

export function playerBackdropSurface(tone: BackdropTone | null) {
  const s = PLAYER_BACKDROP;
  const lightness = tone
    ? clamp(tone.lightness, s.surfaceMinimum, s.surfaceMaximum)
    : s.neutralLightness;
  const chroma = tone
    ? tone.chroma *
      clamp(s.chromaGain - s.chromaSlope * tone.chroma, s.minimumChromaGain, s.maximumChromaGain)
    : 0;
  const top = { lightness, chroma, hue: tone?.hue ?? 0 };
  const bottom = { ...top, lightness: Math.max(s.surfaceMinimum, lightness - s.gradientDrop) };
  // Same chroma at both ends; reduce chroma rather than clipping RGB channels.
  top.chroma = bottom.chroma = Math.min(gamutChroma(top), gamutChroma(bottom));
  return { top, bottom };
}

export function backdropRgb(tone: BackdropTone): Triple {
  return linearRgb(tone).map((v) =>
    Math.round(clamp(v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055, 0, 1) * 255),
  ) as Triple;
}

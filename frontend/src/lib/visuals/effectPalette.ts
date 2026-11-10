// SPDX-License-Identifier: AGPL-3.0-only
import { oklab } from "@/lib/coverTone";
import type { Rgb } from "@/lib/cssColor";

export type EffectPalette = [Rgb, Rgb, Rgb];

export function effectPalette(pixels: ArrayLike<number>, fallback: Rgb): EffectPalette {
  const bins = Array.from({ length: 12 }, () => ({ weight: 0, red: 0, green: 0, blue: 0 }));
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const [lightness, a, b] = oklab(pixels[i], pixels[i + 1], pixels[i + 2]);
    const chroma = Math.hypot(a, b);
    if (lightness < 0.16 || lightness > 0.94 || chroma < 0.035) continue;
    const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    const bin = bins[Math.floor(hue / 30)];
    const weight = chroma * (0.4 + lightness);
    bin.weight += weight;
    bin.red += pixels[i] * weight;
    bin.green += pixels[i + 1] * weight;
    bin.blue += pixels[i + 2] * weight;
  }
  const colors = bins
    .filter((bin) => bin.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((bin): Rgb => {
      const rgb: Rgb = [bin.red / bin.weight, bin.green / bin.weight, bin.blue / bin.weight];
      const lift = Math.max(1, 185 / Math.max(...rgb));
      return rgb.map((channel) => Math.min(255, Math.round(channel * lift))) as Rgb;
    });
  const primary = colors[0] ?? fallback;
  const secondary =
    colors[1] ??
    (primary.map((channel, i) => Math.min(255, channel * 0.65 + [65, 85, 115][i])) as Rgb);
  const accent =
    colors[2] ?? (primary.map((channel) => Math.min(255, channel * 0.55 + 110)) as Rgb);
  return [primary, secondary, accent];
}

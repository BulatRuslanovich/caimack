// SPDX-License-Identifier: AGPL-3.0-only

import type { BackdropTone } from "@/lib/coverTone";

const DARK_SURFACE = { minimum: 0.27, maximum: 0.44, sourceGain: 0.85 };
const SATURATION = { maximum: 0.1, minimumGain: 0.6, softenAbove: 0.4, slope: 1.5 };

export function backdropPalette(tone: BackdropTone | null) {
  if (!tone) return { lightness: DARK_SURFACE.maximum, chroma: 0, hue: 0 };
  const lightness = Math.max(
    DARK_SURFACE.minimum,
    Math.min(DARK_SURFACE.maximum, tone.lightness * DARK_SURFACE.sourceGain),
  );
  const gain = Math.max(
    SATURATION.minimumGain,
    Math.min(1, 1 - (tone.lightness - SATURATION.softenAbove) * SATURATION.slope),
  );
  return { lightness, chroma: Math.min(tone.chroma * gain, SATURATION.maximum), hue: tone.hue };
}

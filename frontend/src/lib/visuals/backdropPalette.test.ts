// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { backdropPalette } from "./backdropPalette";

describe("playback backdrop surface", () => {
  it("keeps a dark saturated blue dark instead of whitening it", () => {
    const color = backdropPalette({ hue: 265, chroma: 0.06, lightness: 0.18 });
    expect(color.lightness).toBeLessThan(0.3);
    expect(color.chroma).toBeGreaterThan(0.05);
    expect(color.hue).toBe(265);
  });

  it("retains muted photographic colour while limiting bright covers", () => {
    const muted = backdropPalette({ hue: 260, chroma: 0.039, lightness: 0.8 });
    expect(muted.chroma).toBeGreaterThan(0.02);
    const bright = backdropPalette({ hue: 150, chroma: 0.25, lightness: 0.95 });
    expect(bright.lightness).toBeLessThan(0.5);
    expect(bright.chroma).toBeLessThanOrEqual(0.1);
  });

  it("uses a visible neutral surface for monochrome or missing covers", () => {
    expect(backdropPalette(null)).toEqual({ lightness: 0.44, chroma: 0, hue: 0 });
  });
});

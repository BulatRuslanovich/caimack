// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { MapPoint } from "@/lib/types";
import { buildStarfield, stellarColours } from "./starfield";

const point = (id: number, x: number, y: number): MapPoint => ({
  id: String(id),
  x,
  y,
  title: `Track ${id}`,
  artist: "Artist",
  hasCover: false,
  plays: 0,
});

describe("library starfield", () => {
  it("places nebulae at real concentrations of tracks and leaves empty space clear", () => {
    const points = Array.from({ length: 100 }, (_, i) => point(i, 0.25, 0.25));
    points.push(point(100, 0.75, 0.75));
    const field = buildStarfield(points);
    const sample = (x: number, y: number) => {
      const gx = Math.floor(
        ((x - field.bounds.minX) / (field.bounds.maxX - field.bounds.minX)) * field.size,
      );
      const gy = Math.floor(
        ((y - field.bounds.minY) / (field.bounds.maxY - field.bounds.minY)) * field.size,
      );
      return field.density[gy * field.size + gx];
    };
    expect(sample(0.25, 0.25)).toBeGreaterThan(sample(0.75, 0.75) * 5);
    expect(sample(0.5, 0.5)).toBe(0);
  });
  it("preserves all track coordinates and gives stars stable identities when data is reordered", () => {
    const points = [point(1, 0.2, 0.3), point(2, 0.6, 0.8), point(3, 0.8, 0.2)];
    const before = points.map((p) => ({ ...p }));
    const first = buildStarfield(points),
      reversed = buildStarfield([...points].reverse());
    expect(points).toEqual(before);
    expect(first.stars).toHaveLength(points.length);
    expect([...first.stars].reverse()).toEqual(reversed.stars);
    expect(first.density).toEqual(reversed.density);
  });
  it("handles empty, singleton and invalid-coordinate data without creating non-finite field values", () => {
    for (const points of [[], [point(1, 0.5, 0.5)], [point(1, NaN, Infinity)]]) {
      const field = buildStarfield(points);
      expect([...field.density].every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
      expect(field.stars.every((star) => Number.isFinite(star.tint))).toBe(true);
      if (points.length === 0) expect(field.density.every((v) => v === 0)).toBe(true);
    }
  });
  it("uses distinct, valid stellar colours in dark and light themes", () => {
    const dark = stellarColours([240, 240, 240], false),
      light = stellarColours([40, 40, 40], true);
    expect(dark).toHaveLength(6);
    expect(light).not.toEqual(dark);
    expect(new Set(dark.map((c) => c.join())).size).toBe(6);
    expect([...dark, ...light].flat().every((c) => Number.isFinite(c) && c >= 0 && c <= 255)).toBe(
      true,
    );
  });
});

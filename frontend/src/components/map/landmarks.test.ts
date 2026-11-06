// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import type { MapPoint } from "@/lib/types";
import { landmarkAt, mapLandmarks, visibleLandmarks } from "./landmarks";

const track = (id: number, x: number, y: number, extra: Partial<MapPoint> = {}): MapPoint => ({
  id: String(id),
  x,
  y,
  title: `Track ${id}`,
  artist: `Artist ${id}`,
  hasCover: true,
  plays: 0,
  ...extra,
});

describe("map landmarks", () => {
  it("spreads real tracks across the map without repeating artists or albums", () => {
    const points = [
      track(1, 0.5, 0.5, { plays: 10, albumId: "one" }),
      track(2, 0.51, 0.51),
      track(3, 0.1, 0.1),
      track(4, 0.9, 0.9),
      track(5, 0.1, 0.9, { artist: "Artist 1" }),
      track(6, 0.9, 0.1, { albumId: "one" }),
      track(7, NaN, 0.2),
      track(8, 0.3, 0.3, { hasCover: false }),
    ];
    const chosen = mapLandmarks(points, 3);
    expect(chosen.map((point) => point.id)).toEqual(["1", "3", "4"]);
    expect(chosen.every((point) => points.includes(point))).toBe(true);
    expect(mapLandmarks([...points].reverse(), 3)).toEqual(chosen);
    expect(mapLandmarks([])).toEqual([]);
  });

  it("avoids clipped and overlapping labels, and yields to individual covers when zoomed in", () => {
    const points = [track(1, 0.4, 0.4), track(2, 0.42, 0.42), track(3, 0.8, 0.6), track(4, 0, 0)];
    const size = { width: 1000, height: 600 };
    const view = { k: 1, panX: 0, panY: 0 };
    const visible = visibleLandmarks(points, view, size, null, null);
    expect(visible.map((item) => item.point.id)).toEqual(["1", "3"]);
    expect(visibleLandmarks(points, { ...view, k: 4 }, size, null, null)).toEqual([]);
    expect(landmarkAt(visible, { x: 240, y: 285 })?.id).toBe("1");
    expect(landmarkAt(visible, { x: 600, y: 500 })).toBeNull();
  });

  it("keeps only landmarks in the selected genre or lasso on mobile", () => {
    const points = [track(1, 0.3, 0.2, { genre: "Rock" }), track(2, 0.65, 0.7, { genre: "Jazz" })];
    const view = { k: 1, panX: 0, panY: 0 };
    const size = { width: 390, height: 600 };
    expect(visibleLandmarks(points, view, size, "Rock", null).map((item) => item.point.id)).toEqual(
      ["1"],
    );
    expect(
      visibleLandmarks(points, view, size, null, new Set(["2"])).map((item) => item.point.id),
    ).toEqual(["2"]);
  });
});

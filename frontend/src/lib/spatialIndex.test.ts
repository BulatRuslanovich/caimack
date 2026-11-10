// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { constellation, type Spot } from "./libraryMap";
import { SpatialIndex } from "./spatialIndex";

function brute(points: Spot[], at: Spot, count: number, exclude = -1, radius = Infinity) {
  return points
    .map((p, index) => ({ index, distanceSquared: (p.x - at.x) ** 2 + (p.y - at.y) ** 2 }))
    .filter((p) => p.index !== exclude && p.distanceSquared <= radius * radius)
    .sort((a, b) => a.distanceSquared - b.distanceSquared || a.index - b.index)
    .slice(0, count);
}
function oldLinks(points: Spot[]) {
  const nearest = points.map((p, i) => brute(points, p, 2, i));
  const distances = nearest.map((n) => n[0].distanceSquared).sort((a, b) => a - b);
  const reach = distances[Math.floor(distances.length / 2)] * 2.5 ** 2;
  const seen = new Set<string>(),
    result: [number, number][] = [];
  nearest.forEach((found, i) =>
    found.forEach(({ index: j, distanceSquared }) => {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (distanceSquared > reach || seen.has(key)) return;
      seen.add(key);
      result.push(i < j ? [i, j] : [j, i]);
    }),
  );
  return result;
}
describe("SpatialIndex", () => {
  it("matches exhaustive neighbours and the original constellation for seeded clouds", () => {
    let state = 9351;
    const random = () => ((state = Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    for (const count of [2, 17, 120, 500]) {
      const points = Array.from({ length: count }, () => ({ x: random(), y: random() }));
      const original = structuredClone(points),
        index = new SpatialIndex(points);
      for (let i = 0; i < count; i += 7)
        expect(index.nearest(points[i], 3, { exclude: i })).toEqual(brute(points, points[i], 3, i));
      expect(constellation(points)).toEqual(oldLinks(points));
      expect(points).toEqual(original);
    }
  });
  it("preserves original array order for equal distances and coincident points", () => {
    const points = Array.from({ length: 1000 }, () => ({ x: 0, y: 0 }));
    const index = new SpatialIndex(points);
    expect(index.nearest({ x: 0, y: 0 }, 2, { exclude: 0 })).toEqual([
      { index: 1, distanceSquared: 0 },
      { index: 2, distanceSquared: 0 },
    ]);
    const circle = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];
    expect(new SpatialIndex(circle).nearest({ x: 0, y: 0 }, 2)).toEqual(
      brute(circle, { x: 0, y: 0 }, 2),
    );
    expect(constellation(points)).toEqual(oldLinks(points));
  });
  it("honours radius and empty or invalid queries", () => {
    const index = new SpatialIndex([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: NaN, y: 0 },
    ]);
    expect(index.nearest({ x: 1, y: 0 }, 3, { radius: 1 })).toEqual([
      { index: 0, distanceSquared: 1 },
      { index: 1, distanceSquared: 1 },
    ]);
    expect(index.nearest({ x: 1, y: 0 }, 1, { radius: 0.9 })).toEqual([]);
    expect(index.nearest({ x: NaN, y: 0 })).toEqual([]);
    expect(new SpatialIndex([]).nearest({ x: 0, y: 0 })).toEqual([]);
  });
});

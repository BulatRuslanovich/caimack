// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  alongPath,
  centreOn,
  closestToCentre,
  constellation,
  fitView,
  flight,
  playsLevel,
  pointInPolygon,
  resizeView,
  smoothPath,
  soundPath,
  toMap,
  toScreen,
  zoomAt,
} from "@/lib/libraryMap";

describe("map view", () => {
  it("fits the unit square into the middle of a wide canvas", () => {
    const view = fitView(800, 400);

    expect(toScreen({ x: 0, y: 0 }, view, 400)).toEqual({ x: 200, y: 0 });
    expect(toScreen({ x: 1, y: 1 }, view, 400)).toEqual({ x: 600, y: 400 });
  });

  it("keeps the spot under the cursor in place while zooming", () => {
    const view = fitView(500, 500);
    const cursor = { x: 120, y: 340 };
    const under = toMap(cursor, view, 500);

    const zoomed = zoomAt(view, 2.5, cursor);

    expect(zoomed.k).toBe(2.5);
    const after = toScreen(under, zoomed, 500);
    expect(after.x).toBeCloseTo(cursor.x);
    expect(after.y).toBeCloseTo(cursor.y);
  });

  it("fills the canvas with the tracks themselves when their bounds are known", () => {
    const view = fitView(1000, 500, { minX: 0.4, minY: 0.4, maxX: 0.6, maxY: 0.5 });

    const middle = toScreen({ x: 0.5, y: 0.45 }, view, 500);
    expect(middle.x).toBeCloseTo(500);
    expect(middle.y).toBeCloseTo(250);

    const top = toScreen({ x: 0.5, y: 0.4 }, view, 500);
    expect(top.y).toBeGreaterThanOrEqual(40);
    expect(top.y).toBeLessThan(80);
  });

  it("stops zooming at the limit", () => {
    expect(zoomAt(fitView(100, 100), 1000, { x: 0, y: 0 }).k).toBe(MAX_ZOOM);
  });

  it("keeps the viewed track centred and the zoom unchanged across screen orientations", () => {
    const desktop = { width: 1200, height: 600 };
    const phone = { width: 320, height: 480 };
    const track = { x: 0.73, y: 0.24 };
    const view = centreOn(track, 3.5, desktop.width, desktop.height);
    const portrait = resizeView(view, desktop, phone);
    const at = toScreen(track, portrait, phone.width);

    expect(at.x).toBeCloseTo(phone.width / 2);
    expect(at.y).toBeCloseTo(phone.height / 2);
    expect(portrait.k).toBe(view.k);

    const restored = resizeView(portrait, phone, desktop);
    expect(restored.panX).toBeCloseTo(view.panX);
    expect(restored.panY).toBeCloseTo(view.panY);
  });
});

describe("pointInPolygon", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  it("tells inside from outside", () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, square)).toBe(false);
  });
});

describe("soundPath", () => {
  it("walks from the left edge to each nearest neighbour in turn", () => {
    const spots = [
      { id: "c", x: 0.9, y: 0 },
      { id: "a", x: 0, y: 0 },
      { id: "d", x: 0.1, y: 0.9 },
      { id: "b", x: 0.1, y: 0.1 },
    ];

    expect(soundPath(spots).map((spot) => spot.id)).toEqual(["a", "b", "d", "c"]);
  });
});

describe("closestToCentre", () => {
  it("keeps the middle of a large selection", () => {
    const spots = [0, 0.4, 0.5, 0.6, 1].map((x) => ({ x, y: 0 }));

    expect(
      closestToCentre(spots, 3)
        .map((spot) => spot.x)
        .sort(),
    ).toEqual([0.4, 0.5, 0.6]);
  });
});

describe("playsLevel", () => {
  it("rises fast for the first plays and saturates at the most played", () => {
    expect(playsLevel(0, 50)).toBe(0);
    expect(playsLevel(50, 50)).toBe(1);
    expect(playsLevel(5, 50)).toBeGreaterThan(0.4);
  });
});

describe("constellation", () => {
  it("links neighbours inside a cluster but not across the gap between clusters", () => {
    const spots = [
      { x: 0.1, y: 0.1 },
      { x: 0.12, y: 0.1 },
      { x: 0.11, y: 0.12 },
      { x: 0.9, y: 0.9 },
      { x: 0.92, y: 0.9 },
      { x: 0.91, y: 0.92 },
    ];

    const links = constellation(spots);

    expect(links.length).toBeGreaterThan(0);
    for (const [a, b] of links) expect(a < 3).toBe(b < 3);
  });

  it("lists every pair once", () => {
    const spots = [
      { x: 0, y: 0 },
      { x: 0.01, y: 0 },
    ];

    expect(constellation(spots)).toEqual([[0, 1]]);
  });
});

describe("flight", () => {
  const from = centreOn({ x: 0.2, y: 0.2 }, 3, 800, 400);
  const to = centreOn({ x: 0.7, y: 0.6 }, 5, 800, 400);

  it("starts and lands exactly on the given views", () => {
    const start = flight(from, to, 0, 800, 400);
    const end = flight(from, to, 1, 800, 400);

    expect(start.k).toBeCloseTo(from.k);
    expect(start.panX).toBeCloseTo(from.panX);
    expect(end.k).toBeCloseTo(to.k);
    expect(end.panY).toBeCloseTo(to.panY);
  });

  it("pulls back mid-way across a long jump", () => {
    expect(flight(from, to, 0.5, 800, 400).k).toBeLessThan(from.k);
  });

  it("zooms in place when the centre stays put", () => {
    const near = centreOn({ x: 0.5, y: 0.5 }, 8, 800, 400);
    const middle = flight(fitView(800, 400), near, 0.5, 800, 400);

    expect(toScreen({ x: 0.5, y: 0.5 }, middle, 400).x).toBeCloseTo(400);
    expect(middle.k).toBeGreaterThan(1);
    expect(middle.k).toBeLessThan(8);
  });
});

describe("smoothPath", () => {
  const spots = [
    { x: 0, y: 0 },
    { x: 10, y: 5 },
    { x: 20, y: 0 },
  ];

  it("passes through every spot", () => {
    const path = smoothPath(spots, 4);

    expect(path).toHaveLength(9);
    expect(path[4].x).toBeCloseTo(10);
    expect(path[4].y).toBeCloseTo(5);
    expect(path[8]).toEqual({ x: 20, y: 0 });
  });

  it("finds spots part of the way along", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ];

    expect(alongPath(line, 0.25)).toEqual({ x: 5, y: 0 });
    expect(alongPath(line, 1)).toEqual({ x: 20, y: 0 });
  });
});

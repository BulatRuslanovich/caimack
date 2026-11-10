// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { Spot } from "./libraryMap";

interface Entry extends Spot {
  index: number;
}
interface Node {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  first: number;
  entries?: Entry[];
  left?: Node;
  right?: Node;
}
export interface Neighbour {
  index: number;
  distanceSquared: number;
}

function build(entries: Entry[]): Node | undefined {
  if (!entries.length) return;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    first = Infinity;
  for (const p of entries) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    first = Math.min(first, p.index);
  }
  const node: Node = { minX, minY, maxX, maxY, first };
  if (entries.length <= 16) node.entries = entries;
  else {
    const axis = maxX - minX >= maxY - minY ? "x" : "y";
    entries.sort((a, b) => a[axis] - b[axis] || a.index - b.index);
    const middle = entries.length >>> 1;
    node.left = build(entries.slice(0, middle));
    node.right = build(entries.slice(middle));
  }
  return node;
}

function distanceTo(node: Node, at: Spot): number {
  const dx = Math.max(node.minX - at.x, 0, at.x - node.maxX);
  const dy = Math.max(node.minY - at.y, 0, at.y - node.maxY);
  return dx * dx + dy * dy;
}

/** Exact nearest neighbours, with original array order as the distance tie-breaker. */
export class SpatialIndex {
  private readonly root: Node | undefined;
  constructor(points: readonly Spot[]) {
    this.root = build(
      points.flatMap((p, index) =>
        Number.isFinite(p.x) && Number.isFinite(p.y) ? [{ x: p.x, y: p.y, index }] : [],
      ),
    );
  }

  nearest(at: Spot, count = 1, { exclude = -1, radius = Infinity } = {}): Neighbour[] {
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y) || count < 1 || radius < 0) return [];
    const found: Neighbour[] = [];
    const limit = Math.floor(count);
    const maximum = radius * radius;
    const visit = (node: Node | undefined) => {
      if (!node) return;
      const bound = distanceTo(node, at);
      const last = found[found.length - 1];
      if (
        bound > maximum ||
        (found.length === limit &&
          (bound > last.distanceSquared ||
            (bound === last.distanceSquared && node.first >= last.index)))
      )
        return;
      if (node.entries) {
        for (const point of node.entries) {
          if (point.index === exclude) continue;
          const distanceSquared = (point.x - at.x) ** 2 + (point.y - at.y) ** 2;
          if (distanceSquared > maximum) continue;
          const last = found[found.length - 1];
          if (
            found.length === limit &&
            (distanceSquared > last.distanceSquared ||
              (distanceSquared === last.distanceSquared && point.index >= last.index))
          )
            continue;
          found.push({ index: point.index, distanceSquared });
          found.sort((a, b) => a.distanceSquared - b.distanceSquared || a.index - b.index);
          if (found.length > limit) found.pop();
        }
      } else {
        const left = node.left!,
          right = node.right!;
        if (distanceTo(left, at) <= distanceTo(right, at)) {
          visit(left);
          visit(right);
        } else {
          visit(right);
          visit(left);
        }
      }
    };
    visit(this.root);
    return found;
  }
}

// SPDX-License-Identifier: AGPL-3.0-only

import type { Spot } from "./libraryMap";

interface Entry extends Spot {
  index: number;
  z: number;
}
interface Node {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
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
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity,
    first = Infinity;
  for (const p of entries) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    minZ = Math.min(minZ, p.z);
    maxY = Math.max(maxY, p.y);
    maxZ = Math.max(maxZ, p.z);
    first = Math.min(first, p.index);
  }
  const node: Node = { minX, minY, minZ, maxX, maxY, maxZ, first };
  if (entries.length <= 16) node.entries = entries;
  else {
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const axis = maxZ - minZ > Math.max(spanX, spanY) ? "z" : spanX >= spanY ? "x" : "y";
    entries.sort((a, b) => a[axis] - b[axis] || a.index - b.index);
    const middle = entries.length >>> 1;
    node.left = build(entries.slice(0, middle));
    node.right = build(entries.slice(middle));
  }
  return node;
}

function distanceTo(node: Node, at: Spot, z: number): number {
  const dx = Math.max(node.minX - at.x, 0, at.x - node.maxX);
  const dy = Math.max(node.minY - at.y, 0, at.y - node.maxY);
  const dz = Math.max(node.minZ - z, 0, z - node.maxZ);
  return dx * dx + dy * dy + dz * dz;
}

/** Exact nearest neighbours, with original array order as the distance tie-breaker. */
export class SpatialIndex {
  private readonly root: Node | undefined;
  constructor(points: readonly Spot[]) {
    this.root = build(
      points.flatMap(({ x, y, z = 0 }, index) =>
        Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? [{ x, y, z, index }] : [],
      ),
    );
  }

  nearest(at: Spot, count = 1, { exclude = -1, radius = Infinity } = {}): Neighbour[] {
    const z = at.z ?? 0;
    if (
      !Number.isFinite(at.x) ||
      !Number.isFinite(at.y) ||
      !Number.isFinite(z) ||
      count < 1 ||
      radius < 0
    )
      return [];
    const found: Neighbour[] = [];
    const limit = Math.floor(count);
    const maximum = radius * radius;
    const visit = (node: Node | undefined) => {
      if (!node) return;
      const bound = distanceTo(node, at, z);
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
          const distanceSquared =
            (point.x - at.x) ** 2 + (point.y - at.y) ** 2 + (point.z - z) ** 2;
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
        if (distanceTo(left, at, z) <= distanceTo(right, at, z)) {
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

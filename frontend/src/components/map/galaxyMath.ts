// SPDX-License-Identifier: AGPL-3.0-only

import { boundsOf, pointInPolygon, type Spot } from "@/lib/libraryMap";
import { Matrix4, Vector3, type PerspectiveCamera } from "three";

export const GALAXY_FOV = 42;
export const MIN_DISTANCE = 0.017;
export const MAX_DISTANCE = 8;
export const MAP_TILT = new Vector3(0.51, 0.39, 0.77).normalize();
const HIT_RADIUS = 13;

export function galaxyPosition({ x, y, z = 0.5 }: Spot): Vector3 {
  return new Vector3(x - 0.5, 0.5 - y, z - 0.5);
}

export function fitGalaxy(radius: number, aspect: number): number {
  const halfFov = (GALAXY_FOV * Math.PI) / 360;
  const limit = Math.min(halfFov, Math.atan(Math.tan(halfFov) * aspect));
  return (Math.max(0.12, radius) * 1.12) / Math.sin(limit);
}

export interface ProjectedPoint extends Spot {
  depth: number;
}

export function galaxyProjector(camera: PerspectiveCamera, width: number, height: number) {
  const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const m = matrix.elements;
  return (point: Vector3): ProjectedPoint | null => {
    const { x, y, z } = point;
    const depth = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (depth < camera.near || depth > camera.far) return null;
    const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / depth;
    const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / depth;
    if (Math.abs(nx) > 1 || Math.abs(ny) > 1) return null;
    return { x: ((nx + 1) * width) / 2, y: ((1 - ny) * height) / 2, depth };
  };
}

interface GalaxyPoint {
  position: Vector3;
}

export function pickGalaxyPoint<T extends GalaxyPoint>(
  stars: readonly T[],
  project: (position: Vector3) => ProjectedPoint | null,
  at: Spot,
  eye: Vector3,
) {
  let hit: { star: T; at: ProjectedPoint } | null = null;
  let nearest = Infinity;
  for (const star of stars) {
    const spot = project(star.position);
    if (!spot || (spot.x - at.x) ** 2 + (spot.y - at.y) ** 2 > HIT_RADIUS ** 2) continue;
    const distance = star.position.distanceToSquared(eye);
    if (distance < nearest) {
      nearest = distance;
      hit = { star, at: spot };
    }
  }
  return hit;
}

export function lassoGalaxyPoints<T extends GalaxyPoint>(
  stars: readonly T[],
  project: (position: Vector3) => ProjectedPoint | null,
  polygon: Spot[],
): T[] {
  const bounds = boundsOf(polygon);
  if (!bounds || polygon.length < 3) return [];
  const { minX, maxX, minY, maxY } = bounds;
  return stars.filter(({ position }) => {
    const at = project(position);
    return (
      at &&
      at.x >= minX &&
      at.x <= maxX &&
      at.y >= minY &&
      at.y <= maxY &&
      pointInPolygon(at, polygon)
    );
  });
}

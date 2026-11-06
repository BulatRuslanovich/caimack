// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { toScreen, type MapView, type Spot } from "@/lib/libraryMap";
import type { MapPoint } from "@/lib/types";

export const LANDMARK_TOP = 23;
export const LANDMARK_BOTTOM = 65;
export const LANDMARK_ZOOM = 4;

// These are actual tracks spread across the map, not inferred genre regions.
export function mapLandmarks(points: MapPoint[], limit = 12): MapPoint[] {
  const candidates = points
    .filter((point) => point.hasCover && Number.isFinite(point.x) && Number.isFinite(point.y))
    .slice()
    .sort((a, b) => b.plays - a.plays || a.id.localeCompare(b.id));
  const chosen: MapPoint[] = [];
  const artists = new Set<string>();
  const albums = new Set<string>();
  while (chosen.length < limit) {
    let best: MapPoint | undefined;
    let distance = -1;
    for (const point of candidates) {
      if (chosen.includes(point) || (point.artist && artists.has(point.artist))) continue;
      if (point.albumId && albums.has(point.albumId)) continue;
      const nearest = chosen.reduce(
        (min, other) => Math.min(min, (point.x - other.x) ** 2 + (point.y - other.y) ** 2),
        Infinity,
      );
      if (nearest > distance) {
        distance = nearest;
        best = point;
      }
    }
    if (!best) break;
    chosen.push(best);
    if (best.artist) artists.add(best.artist);
    if (best.albumId) albums.add(best.albumId);
  }
  return chosen;
}

export interface Landmark {
  point: MapPoint;
  at: Spot;
  labelX: number;
  width: number;
}

export function visibleLandmarks(
  points: MapPoint[],
  view: MapView,
  size: { width: number; height: number },
  genre: string | null,
  selectedIds: ReadonlySet<string> | null,
): Landmark[] {
  if (view.k >= LANDMARK_ZOOM) return [];
  const visible: Landmark[] = [];
  const base = Math.min(size.width, size.height);
  const width = size.width < 600 ? 132 : 160;
  for (const point of points) {
    if (genre && point.genre !== genre) continue;
    if (selectedIds && !selectedIds.has(point.id)) continue;
    const at = toScreen(point, view, base);
    if (
      at.x < 24 ||
      at.x > size.width - 24 ||
      at.y < LANDMARK_TOP + 8 ||
      at.y > size.height - LANDMARK_BOTTOM - 8
    )
      continue;
    const labelX = Math.max(width / 2 + 8, Math.min(size.width - width / 2 - 8, at.x));
    if (
      visible.some(
        (other) =>
          Math.abs(other.labelX - labelX) < width + 12 &&
          Math.abs(other.at.y - at.y) < LANDMARK_TOP + LANDMARK_BOTTOM + 16,
      )
    )
      continue;
    visible.push({ point, at, labelX, width });
    if (visible.length >= (size.width < 600 ? 3 : 7)) break;
  }
  return visible;
}

export function landmarkAt(landmarks: Landmark[], at: Spot): MapPoint | null {
  return (
    landmarks.find(
      (item) =>
        (Math.abs(at.x - item.at.x) <= LANDMARK_TOP &&
          Math.abs(at.y - item.at.y) <= LANDMARK_TOP) ||
        (Math.abs(at.x - item.labelX) <= item.width / 2 &&
          at.y >= item.at.y + 20 &&
          at.y <= item.at.y + LANDMARK_BOTTOM),
    )?.point ?? null
  );
}

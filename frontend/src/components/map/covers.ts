// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { coverUrl } from "@/lib/media";
import type { MapPoint } from "@/lib/types";

const TILE_PX = 72;
const KEPT = 600;
const IN_FLIGHT = 16;

const tiles = new Map<string, HTMLCanvasElement | null>();
let loading = 0;

function roundTile(image: HTMLImageElement): HTMLCanvasElement {
  const tile = document.createElement("canvas");
  tile.width = TILE_PX;
  tile.height = TILE_PX;

  const context = tile.getContext("2d")!;
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  context.beginPath();
  context.arc(TILE_PX / 2, TILE_PX / 2, TILE_PX / 2, 0, Math.PI * 2);
  context.clip();
  context.drawImage(
    image,
    (image.naturalWidth - side) / 2,
    (image.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    TILE_PX,
    TILE_PX,
  );

  return tile;
}

export function coverTile(point: MapPoint, ready: () => void): HTMLCanvasElement | null {
  const url = coverUrl({
    albumId: point.albumId,
    trackId: point.id,
    hasCover: point.hasCover,
    variant: "thumb",
  });
  if (!url) return null;
  if (tiles.has(url)) return tiles.get(url) ?? null;
  if (loading >= IN_FLIGHT) return null;

  tiles.set(url, null);
  if (tiles.size > KEPT) tiles.delete(tiles.keys().next().value!);
  loading += 1;

  const image = new Image();
  image.decoding = "async";
  image.onload = () => {
    loading -= 1;
    if (tiles.has(url) && image.naturalWidth > 0) tiles.set(url, roundTile(image));
    ready();
  };
  image.onerror = () => {
    loading -= 1;
    ready();
  };
  image.src = url;

  return null;
}

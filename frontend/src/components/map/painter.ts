// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { rgba } from "@/lib/cssColor";
import { alongPath, smoothPath, toScreen, type MapView } from "@/lib/libraryMap";
import {
  dotRadius,
  paintMap,
  readPalette,
  type HaloCache,
  type Palette,
  type Scene,
} from "./paint";

interface Size {
  width: number;
  height: number;
}
const MAX_CACHE_PIXELS = 4_000_000; // Two RGBA layers: at most 32 MB, in addition to the visible canvas.

/** Geometry is captured when the view changes, rather than rebuilt by the animation clock. */
function prepareMotion(palette: Palette, view: MapView, size: Size, halo: HaloCache, scene: Scene) {
  const radius = dotRadius(view.k, size.width);
  const coverShare = scene.covers ? Math.max(0, Math.min(1, (view.k - 3) / 3)) : 0;
  const mark = radius + (14 - radius) * coverShare;
  const screen = (p: { x: number; y: number }) =>
    toScreen(p, view, Math.min(size.width, size.height));
  const point = scene.points.find((p) => p.id === scene.nowPlayingId);
  const spot = point && screen(point);
  const current =
    spot &&
    spot.x >= -mark &&
    spot.x <= size.width + mark &&
    spot.y >= -mark &&
    spot.y <= size.height + mark
      ? spot
      : null;
  const route =
    scene.route && scene.route.ahead.length > 0
      ? smoothPath([scene.route.at, ...scene.route.ahead].map(screen), 12)
      : null;
  const moving = scene.motion && scene.playing && Boolean(current || route);
  return {
    moving,
    draw(ctx: CanvasRenderingContext2D, time: number) {
      ctx.save();
      ctx.globalAlpha = 1;
      if (route && moving) {
        const duration = 1600 * scene.route!.ahead.length;
        const share = (time % duration) / duration;
        const spark = alongPath(route, share);
        ctx.globalAlpha = 1 - 0.7 * share;
        ctx.drawImage(halo.sprite, spark.x - 16, spark.y - 16, 32, 32);
        ctx.fillStyle = rgba(palette.primary, 1);
        ctx.beginPath();
        ctx.arc(spark.x, spark.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(palette.onPrimary, 0.9);
        ctx.beginPath();
        ctx.arc(spark.x, spark.y, 1.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (current && scene.intro > 0) {
        const reach = radius * 9 * (moving ? 1 + 0.08 * Math.sin((time / 2400) * Math.PI * 2) : 1);
        ctx.drawImage(halo.sprite, current.x - reach, current.y - reach, reach * 2, reach * 2);
        if (moving) {
          ctx.lineWidth = 1.5;
          for (const offset of [0, 0.5]) {
            const phase = (time / 2400 + offset) % 1;
            ctx.strokeStyle = rgba(palette.primary, 0.55 * (1 - phase) ** 2);
            ctx.beginPath();
            ctx.arc(current.x, current.y, mark + 5 + phase * 26, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    },
  };
}

export function createMapPainter(context: CanvasRenderingContext2D) {
  const background = document.createElement("canvas"),
    foreground = document.createElement("canvas");
  const back = background.getContext("2d"),
    front = foreground.getContext("2d");
  const halo: { current: HaloCache | null } = { current: null };
  let palette: Palette | null = null;
  let previous = "";
  let motion: ReturnType<typeof prepareMotion> | null = null;
  let cached = false;
  return {
    themeChanged() {
      palette = null;
      cached = false;
    },
    draw(view: MapView, size: Size, scene: Scene, dirty: boolean) {
      const width = context.canvas.width,
        height = context.canvas.height;
      const key = [width, height, view.k, view.panX, view.panY, scene.intro, scene.reveal].join(
        ":",
      );
      const useCache = Boolean(back && front && width * height <= MAX_CACHE_PIXELS);
      const rebuild = dirty || !cached || key !== previous || !palette;
      palette ??= readPalette(context.canvas);
      if (rebuild || !useCache) {
        if (useCache) {
          if (background.width !== width || background.height !== height) {
            background.width = foreground.width = width;
            background.height = foreground.height = height;
          }
          paintMap(back!, palette, view, size, halo, scene, () => front!);
          motion = prepareMotion(palette, view, size, halo.current!, scene);
          cached = true;
        } else {
          // Very large/high-DPI views avoid allocating two oversized raster layers.
          paintMap(context, palette, view, size, halo, scene, () => {
            motion = prepareMotion(palette!, view, size, halo.current!, scene);
            motion.draw(context, scene.time);
            return context;
          });
          cached = false;
        }
        previous = key;
      }
      if (useCache) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, width, height);
        context.drawImage(background, 0, 0);
        const ratio = width / size.width;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        motion?.draw(context, scene.time);
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.drawImage(foreground, 0, 0);
      }
      return motion?.moving ?? false;
    },
    destroy() {
      background.width = background.height = foreground.width = foreground.height = 0;
      motion = null;
      palette = null;
    },
  };
}

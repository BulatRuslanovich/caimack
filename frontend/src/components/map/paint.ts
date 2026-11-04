// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import {
  easeOut,
  playsLevel,
  alongPath,
  smoothPath,
  toMap,
  toScreen,
  type MapView,
  type Spot,
} from "@/lib/libraryMap";
import { rgbOf, rgba, type Rgb } from "@/lib/cssColor";
import type { MapPoint } from "@/lib/types";
import type { MapLabel, MapRoute } from "./LibraryMapCanvas";

const LEVELS = 8;
const TERRITORY = 0.14;
const COVER_ZOOM = 4;
const COVER_FADE = 2;
const COVER_RADIUS = 14;
const PULSE_MS = 2400;
const HOP_MS = 1600;
const HOP_SAMPLES = 12;
const PATH_SAMPLES = 6;

export interface Palette {
  primary: Rgb;
  onPrimary: Rgb;
  faint: Rgb;
  ink: Rgb;
  card: Rgb;
  light: boolean;
  font: string;
}

export function readPalette(element: Element): Palette {
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(name);

  return {
    primary: rgbOf(read("--primary")),
    onPrimary: rgbOf(read("--primary-foreground")),
    faint: rgbOf(read("--faint-foreground")),
    ink: rgbOf(read("--foreground")),
    card: rgbOf(read("--card"), [0, 0, 0]),
    light: style.colorScheme === "light",
    font: style.fontFamily,
  };
}

function moodTint(hue: number, light: boolean, alpha: number): string {
  return `oklch(${light ? 0.58 : 0.72} 0.11 ${hue} / ${alpha})`;
}

function haloSprite(color: Rgb, strength: number): HTMLCanvasElement {
  const size = 64;
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;

  const context = sprite.getContext("2d")!;
  const glow = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  glow.addColorStop(0, rgba(color, strength));
  glow.addColorStop(0.4, rgba(color, strength * 0.35));
  glow.addColorStop(1, rgba(color, 0));
  context.fillStyle = glow;
  context.fillRect(0, 0, size, size);

  return sprite;
}

function dotRadius(k: number): number {
  return Math.min(6, 2.2 + 0.9 * Math.log2(k + 1));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface HaloCache {
  key: string;
  sprite: HTMLCanvasElement;
}

export interface Scene {
  points: MapPoint[];
  labels: MapLabel[];
  highlightGenre: string | null;
  nowPlayingId: string | null;
  selectedIds: ReadonlySet<string> | null;
  maxPlays: number;
  links: [number, number][];
  hoveredId: string | null;
  lasso: Spot[] | null;
  playing: boolean;
  route: MapRoute | null;
  path: MapPoint[] | null;
  time: number;
  motion: boolean;
  intro: number;
  reveal: number;
  covers: boolean;
  cover: (point: MapPoint) => CanvasImageSource | null;
}

export function paintMap(
  context: CanvasRenderingContext2D,
  palette: Palette,
  view: MapView,
  size: { width: number; height: number },
  halo: { current: HaloCache | null },
  scene: Scene,
): boolean {
  const {
    points,
    labels,
    highlightGenre,
    nowPlayingId,
    selectedIds,
    maxPlays,
    links,
    hoveredId,
    lasso,
    playing,
    route,
    path,
    time,
    motion,
    intro,
    reveal,
    covers,
    cover,
  } = scene;
  const { width, height } = size;
  const ratio = window.devicePixelRatio || 1;
  const base = Math.min(width, height);
  const radius = dotRadius(view.k);
  const coverShare = covers ? clamp01((view.k - COVER_ZOOM) / COVER_FADE) : 0;
  const mark = coverShare > 0 ? radius + (COVER_RADIUS - radius) * coverShare : radius;
  const settled = easeOut(intro);
  const moods = labels.filter((label) => label.hue !== undefined);
  const screen = (spot: Spot) => toScreen(spot, view, base);
  let moving = false;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.lineCap = "round";
  context.lineJoin = "round";

  const step = 0.1 / 2 ** Math.max(0, Math.floor(Math.log2(view.k)));
  const from = toMap({ x: 0, y: 0 }, view, base);
  const to = toMap({ x: width, y: height }, view, base);
  context.fillStyle = rgba(palette.faint, palette.light ? 0.3 : 0.2);
  context.beginPath();
  for (let gx = Math.floor(from.x / step) * step; gx <= to.x; gx += step) {
    for (let gy = Math.floor(from.y / step) * step; gy <= to.y; gy += step) {
      const spot = screen({ x: gx, y: gy });
      context.moveTo(spot.x + 1, spot.y);
      context.arc(spot.x, spot.y, 1, 0, Math.PI * 2);
    }
  }
  context.fill();

  for (const label of moods) {
    const spot = screen(label);
    const reach = TERRITORY * base * view.k * (0.4 + 0.6 * settled);
    const glow = context.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, reach);
    glow.addColorStop(
      0,
      moodTint(label.hue!, palette.light, (palette.light ? 0.2 : 0.16) * settled),
    );
    glow.addColorStop(1, moodTint(label.hue!, palette.light, 0));
    context.fillStyle = glow;
    context.fillRect(spot.x - reach, spot.y - reach, reach * 2, reach * 2);
  }

  const hoveredIndex =
    hoveredId === null ? -1 : points.findIndex((point) => point.id === hoveredId);
  const neighbours: Spot[] = [];
  const linkShare = clamp01((intro - 0.75) / 0.25);

  if (linkShare > 0) {
    context.beginPath();
    for (const [a, b] of links) {
      const start = screen(points[a]);
      const end = screen(points[b]);
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      if (a === hoveredIndex) neighbours.push(end);
      else if (b === hoveredIndex) neighbours.push(start);
    }
    context.lineWidth = 1;
    context.strokeStyle = rgba(palette.ink, (palette.light ? 0.13 : 0.09) * linkShare);
    context.stroke();
  }

  if (neighbours.length > 0) {
    const centre = screen(points[hoveredIndex]);
    context.beginPath();
    for (const spot of neighbours) {
      context.moveTo(centre.x, centre.y);
      context.lineTo(spot.x, spot.y);
    }
    context.lineWidth = 1.5;
    context.strokeStyle = rgba(palette.primary, 0.75);
    context.stroke();
  }

  if (path && path.length > 1) {
    const line = smoothPath(path.map(screen), PATH_SAMPLES);
    const shown = Math.max(2, Math.ceil(line.length * easeOut(reveal)));

    context.beginPath();
    context.moveTo(line[0].x, line[0].y);
    for (let i = 1; i < shown; i++) context.lineTo(line[i].x, line[i].y);
    context.setLineDash([5, 5]);
    context.lineWidth = 1.5;
    context.strokeStyle = rgba(palette.primary, 0.6);
    context.stroke();
    context.setLineDash([]);
  }

  const haloKey = `${palette.primary.join()}:${palette.light}`;
  if (halo.current?.key !== haloKey) {
    halo.current = {
      key: haloKey,
      sprite: haloSprite(palette.primary, palette.light ? 0.3 : 0.4),
    };
  }
  const sprite = halo.current.sprite;

  if (route) {
    if (route.behind.length > 0) {
      const line = smoothPath([...route.behind, route.at].map(screen), HOP_SAMPLES);
      context.beginPath();
      context.moveTo(line[0].x, line[0].y);
      for (const spot of line) context.lineTo(spot.x, spot.y);
      context.setLineDash([2, 6]);
      context.lineWidth = 1.5;
      context.strokeStyle = rgba(palette.ink, palette.light ? 0.3 : 0.25);
      context.stroke();
      context.setLineDash([]);
    }

    if (route.ahead.length > 0) {
      const hops = route.ahead.length;
      const line = smoothPath([route.at, ...route.ahead].map(screen), HOP_SAMPLES);

      context.lineWidth = 2;
      for (let hop = 0; hop < hops; hop++) {
        context.beginPath();
        context.moveTo(line[hop * HOP_SAMPLES].x, line[hop * HOP_SAMPLES].y);
        for (let i = hop * HOP_SAMPLES + 1; i <= (hop + 1) * HOP_SAMPLES; i++) {
          context.lineTo(line[i].x, line[i].y);
        }
        context.strokeStyle = rgba(palette.primary, 0.12 + 0.68 * (1 - hop / hops));
        context.stroke();
      }

      if (motion && playing) {
        const share = (time % (HOP_MS * hops)) / (HOP_MS * hops);
        const spark = alongPath(line, share);
        const reach = 16;

        context.globalAlpha = 1 - 0.7 * share;
        context.drawImage(sprite, spark.x - reach, spark.y - reach, reach * 2, reach * 2);
        context.fillStyle = rgba(palette.primary, 1);
        context.beginPath();
        context.arc(spark.x, spark.y, 3, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = rgba(palette.onPrimary, 0.9);
        context.beginPath();
        context.arc(spark.x, spark.y, 1.3, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 1;
        moving = true;
      }
    }
  }

  const emphasised = (point: MapPoint) =>
    selectedIds
      ? selectedIds.has(point.id)
      : highlightGenre
        ? point.genre === highlightGenre
        : null;

  const arrive = (point: MapPoint): { spot: Spot; grown: number } => {
    if (intro >= 1) return { spot: screen(point), grown: 1 };

    let origin: Spot = point;
    let nearest = Infinity;
    for (const mood of moods) {
      const distance = (mood.x - point.x) ** 2 + (mood.y - point.y) ** 2;
      if (distance < nearest) {
        nearest = distance;
        origin = mood;
      }
    }

    const grown = easeOut(clamp01((intro - Math.min(0.5, Math.sqrt(nearest) * 2)) / 0.5));
    return {
      spot: screen({
        x: origin.x + (point.x - origin.x) * grown,
        y: origin.y + (point.y - origin.y) * grown,
      }),
      grown,
    };
  };

  const buckets = new Map<string, Spot[]>();
  const glowing: { spot: Spot; level: number }[] = [];
  const front: Spot[] = [];
  const tiles: { point: MapPoint; spot: Spot; ring: string; alpha: number }[] = [];
  let current: Spot | null = null;
  let ring: Spot | null = null;

  for (const point of points) {
    const { spot, grown } = arrive(point);
    if (grown <= 0) continue;
    if (spot.x < -mark || spot.y < -mark || spot.x > width + mark || spot.y > height + mark)
      continue;

    if (point.id === nowPlayingId) current = spot;
    if (point.id === hoveredId) ring = spot;

    const marked = emphasised(point);
    let fill: string;
    if (marked === true) {
      fill = rgba(palette.primary, 1);
      front.push(spot);
    } else if (marked === false) {
      fill = rgba(palette.faint, 0.14);
    } else {
      const level = Math.round(playsLevel(point.plays, maxPlays) * LEVELS) / LEVELS;
      fill = level === 0 ? rgba(palette.faint, 0.42) : rgba(palette.primary, 0.3 + 0.7 * level);
      if (level > 0) glowing.push({ spot, level: level * grown });
    }

    if (coverShare > 0 && point.hasCover) {
      tiles.push({ point, spot, ring: fill, alpha: (marked === false ? 0.3 : 1) * grown });
    }
    if (marked === true) continue;

    const bucket = buckets.get(fill);
    if (bucket) bucket.push(spot);
    else buckets.set(fill, [spot]);
  }

  const dots = (spots: Spot[], size: number) => {
    context.beginPath();
    for (const spot of spots) {
      context.moveTo(spot.x + size, spot.y);
      context.arc(spot.x, spot.y, size, 0, Math.PI * 2);
    }
    context.fill();
  };

  const rings = (spots: Spot[], size: number) => {
    context.beginPath();
    for (const spot of spots) {
      context.moveTo(spot.x + size, spot.y);
      context.arc(spot.x, spot.y, size, 0, Math.PI * 2);
    }
    context.stroke();
  };

  context.globalCompositeOperation = palette.light ? "multiply" : "lighter";
  for (const { spot, level } of glowing) {
    const reach = radius * (2 + 3.5 * level);
    context.drawImage(sprite, spot.x - reach, spot.y - reach, reach * 2, reach * 2);
  }
  context.globalCompositeOperation = "source-over";

  for (const [fill, spots] of buckets) {
    context.fillStyle = fill;
    dots(spots, radius);
  }

  if (front.length > 0) {
    context.fillStyle = rgba(palette.primary, 1);
    dots(front, radius + 0.5);
  }

  context.lineWidth = 1.5;
  for (const tile of tiles) {
    const image = cover(tile.point);
    if (!image) continue;

    context.globalAlpha = coverShare * tile.alpha;
    context.drawImage(image, tile.spot.x - mark, tile.spot.y - mark, mark * 2, mark * 2);
    context.strokeStyle = tile.ring;
    rings([tile.spot], mark);
  }
  context.globalAlpha = 1;

  if (route && route.ahead.length > 0) {
    context.lineWidth = 1.5;
    route.ahead.forEach((point, hop) => {
      context.strokeStyle = rgba(palette.primary, 0.15 + 0.7 * (1 - hop / route.ahead.length));
      rings([screen(point)], mark + 2.5);
    });
  }

  if (neighbours.length > 0) {
    context.lineWidth = 1.5;
    context.strokeStyle = rgba(palette.primary, 0.7);
    rings(neighbours, mark + 2);
  }

  if (path && path.length > 1 && reveal > 0) {
    context.lineWidth = 2;
    context.strokeStyle = rgba(palette.primary, easeOut(reveal));
    rings([screen(path[0])], mark + 4);
  }

  if (current) {
    const beat = motion && playing;
    const reach = radius * 9 * (beat ? 1 + 0.08 * Math.sin((time / PULSE_MS) * Math.PI * 2) : 1);
    context.drawImage(sprite, current.x - reach, current.y - reach, reach * 2, reach * 2);

    if (beat) {
      context.lineWidth = 1.5;
      for (const offset of [0, 0.5]) {
        const phase = (time / PULSE_MS + offset) % 1;
        context.strokeStyle = rgba(palette.primary, 0.55 * (1 - phase) ** 2);
        rings([current], mark + 5 + phase * 26);
      }
      moving = true;
    }

    if (coverShare === 0) {
      context.fillStyle = rgba(palette.primary, 1);
      dots([current], radius + 1.5);
    }
    context.lineWidth = 2;
    context.strokeStyle = rgba(palette.ink, 1);
    rings([current], mark + 5);
  }

  if (ring) {
    context.lineWidth = 2;
    context.strokeStyle = rgba(palette.ink, 1);
    rings([ring], mark + 3);
  }

  context.textAlign = "left";
  context.textBaseline = "middle";
  context.globalAlpha = clamp01((intro - 0.35) / 0.4);

  const placed: { left: number; right: number; top: number; bottom: number }[] = [];

  for (const label of [...labels].sort(
    (a, b) => Number(b.strong ?? false) - Number(a.strong ?? false),
  )) {
    const spot = screen(label);
    const size = label.strong ? 14 : 12;
    context.font = `${label.strong ? 700 : 600} ${size}px ${palette.font}`;

    const swatch = label.hue === undefined ? 0 : 13;
    const plate = context.measureText(label.text).width + 20 + swatch;
    const height = size + 12;
    let y = spot.y;

    for (let attempt = 0; attempt < 6; attempt++) {
      const box = {
        left: spot.x - plate / 2 - 4,
        right: spot.x + plate / 2 + 4,
        top: y - height / 2 - 2,
        bottom: y + height / 2 + 2,
      };
      const hit = placed.find(
        (other) =>
          box.left < other.right &&
          box.right > other.left &&
          box.top < other.bottom &&
          box.bottom > other.top,
      );
      if (!hit) {
        placed.push(box);
        break;
      }
      y = hit.bottom + height / 2 + 2;
    }

    const left = spot.x - plate / 2;
    context.beginPath();
    context.roundRect(left, y - height / 2, plate, height, height / 2);
    context.fillStyle = label.strong ? rgba(palette.primary, 1) : rgba(palette.card, 0.86);
    context.fill();

    if (!label.strong) {
      context.lineWidth = 1;
      context.strokeStyle =
        label.hue === undefined
          ? rgba(palette.ink, 0.16)
          : moodTint(label.hue, palette.light, 0.55);
      context.stroke();
    }

    if (label.hue !== undefined) {
      context.beginPath();
      context.arc(left + 13, y, 3.5, 0, Math.PI * 2);
      context.fillStyle = moodTint(label.hue, palette.light, 1);
      context.fill();
    }

    context.fillStyle = label.strong ? rgba(palette.onPrimary, 1) : rgba(palette.ink, 1);
    context.fillText(label.text, left + 10 + swatch, y + 0.5);
  }

  context.globalAlpha = 1;

  if (lasso && lasso.length > 1) {
    context.beginPath();
    context.moveTo(lasso[0].x, lasso[0].y);
    for (const spot of lasso) context.lineTo(spot.x, spot.y);
    context.closePath();
    context.fillStyle = rgba(palette.primary, 0.08);
    context.fill();
    context.setLineDash([6, 4]);
    context.lineWidth = 1.5;
    context.strokeStyle = rgba(palette.ink, 1);
    context.stroke();
    context.setLineDash([]);
  }

  return moving;
}

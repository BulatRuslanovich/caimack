// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import {
  easeOut,
  playsLevel,
  alongPath,
  smoothPath,
  toScreen,
  type MapView,
  type Spot,
} from "@/lib/libraryMap";
import { rgbOf, rgba, type Rgb } from "@/lib/cssColor";
import type { MapPoint } from "@/lib/types";
import type { MapLabel, MapRoute } from "./LibraryMapCanvas";
import { LANDMARK_ZOOM, visibleLandmarks } from "./landmarks";
import { nebulaTexture, stellarColours, type Starfield } from "./starfield";

const LEVELS = 8;
const COVER_ZOOM = 3;
const COVER_FADE = 3;
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

function dotRadius(k: number, width: number): number {
  return Math.min(4.5, (width < 600 ? 0.75 : 1.1) + 0.55 * Math.log2(k + 1));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface HaloCache {
  key: string;
  sprite: HTMLCanvasElement;
  stars: HTMLCanvasElement[];
}

export interface Scene {
  points: MapPoint[];
  starfield: Starfield;
  landmarks: MapPoint[];
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
  nebula: boolean;
  cover: (point: MapPoint) => CanvasImageSource | null;
  coverHits: { current: { point: MapPoint; spot: Spot; radius: number }[] };
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
  const radius = dotRadius(view.k, width);
  const colours = stellarColours(palette.primary, palette.light);
  const coverShare = covers ? clamp01((view.k - COVER_ZOOM) / COVER_FADE) : 0;
  const mark = coverShare > 0 ? radius + (COVER_RADIUS - radius) * coverShare : radius;
  const screen = (spot: Spot) => toScreen(spot, view, base);
  let moving = false;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.lineCap = "round";
  context.lineJoin = "round";
  scene.coverHits.current = [];

  const field = scene.starfield;
  const corner = screen({ x: field.bounds.minX, y: field.bounds.minY });
  const far = screen({ x: field.bounds.maxX, y: field.bounds.maxY });
  if (scene.nebula) {
    context.globalAlpha =
      clamp01(1 - (view.k - 1) / 9) * easeOut(intro) * (highlightGenre || selectedIds ? 0.3 : 1);
    context.drawImage(
      nebulaTexture(field, colours, palette.light),
      corner.x,
      corner.y,
      far.x - corner.x,
      far.y - corner.y,
    );
    context.globalAlpha = 1;
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
    context.lineWidth = 0.7;
    context.strokeStyle = rgba(
      palette.light ? palette.ink : colours[1],
      (palette.light ? 0.15 : 0.19) * linkShare,
    );
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
      stars: colours.map((colour) => haloSprite(colour, palette.light ? 0.2 : 0.35)),
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

    return { spot: screen(point), grown: easeOut(clamp01(intro)) };
  };

  const buckets = new Map<string, { spots: Spot[]; size: number; fill: string }>();
  const glowing: { spot: Spot; level: number; tint: number }[] = [];
  const front: Spot[] = [];
  const tiles: { point: MapPoint; spot: Spot; ring: string; alpha: number }[] = [];
  let current: Spot | null = null;
  let ring: Spot | null = null;

  for (let index = 0; index < points.length; index++) {
    const point = points[index],
      star = field.stars[index];
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
      fill = rgba(palette.faint, selectedIds ? 0.1 : 0.18);
    } else {
      const level = Math.round(playsLevel(point.plays, maxPlays) * LEVELS) / LEVELS;
      fill =
        level === 0
          ? rgba(colours[star.tint], star.light * 0.85)
          : rgba(palette.primary, 0.5 + 0.5 * level);
      if (level > 0 || star.beacon)
        glowing.push({ spot, level: (level || 0.25) * grown, tint: level > 0 ? -1 : star.tint });
    }

    if (coverShare > 0 && point.hasCover) {
      tiles.push({ point, spot, ring: fill, alpha: (marked === false ? 0.3 : 1) * grown });
    }
    if (marked === true) continue;

    const size = radius * star.size;
    const key = `${fill}:${star.size}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.spots.push(spot);
    else buckets.set(key, { spots: [spot], size, fill });
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
  for (const { spot, level, tint } of glowing) {
    const reach = radius * (2 + 3.5 * level);
    context.drawImage(
      tint < 0 ? sprite : halo.current.stars[tint],
      spot.x - reach,
      spot.y - reach,
      reach * 2,
      reach * 2,
    );
    if (level > 0.55) {
      const reach = radius * (2 + level * 2);
      context.strokeStyle = rgba(palette.primary, level * 0.4);
      context.lineWidth = 0.65;
      context.beginPath();
      context.moveTo(spot.x - reach, spot.y);
      context.lineTo(spot.x + reach, spot.y);
      context.moveTo(spot.x, spot.y - reach);
      context.lineTo(spot.x, spot.y + reach);
      context.stroke();
    }
  }
  context.globalCompositeOperation = "source-over";

  for (const { fill, spots, size } of buckets.values()) {
    context.fillStyle = fill;
    dots(spots, size);
  }

  if (front.length > 0) {
    context.fillStyle = rgba(palette.primary, 1);
    dots(front, radius + 0.5);
    if (selectedIds) {
      context.lineWidth = 1;
      context.strokeStyle = rgba(palette.ink, 0.7);
      rings(front, radius + 2);
    }
  }

  context.lineWidth = 1.5;
  const occupied = new Map<string, Spot[]>();
  const cell = mark * 2 + 5;
  tiles.sort(
    (a, b) =>
      Number(b.point.id === nowPlayingId || b.point.id === hoveredId) -
        Number(a.point.id === nowPlayingId || a.point.id === hoveredId) ||
      b.point.plays - a.point.plays,
  );
  for (const tile of tiles) {
    const gx = Math.floor(tile.spot.x / cell),
      gy = Math.floor(tile.spot.y / cell);
    let crowded = false;
    for (let x = gx - 1; x <= gx + 1; x++)
      for (let y = gy - 1; y <= gy + 1; y++)
        if (
          occupied
            .get(`${x}:${y}`)
            ?.some((other) => Math.hypot(other.x - tile.spot.x, other.y - tile.spot.y) < cell)
        )
          crowded = true;
    if (crowded && tile.point.id !== nowPlayingId && tile.point.id !== hoveredId) continue;
    const key = `${gx}:${gy}`;
    const placed = occupied.get(key);
    if (placed) placed.push(tile.spot);
    else occupied.set(key, [tile.spot]);
    const image = cover(tile.point);
    if (!image) continue;
    if (coverShare > 0.1)
      scene.coverHits.current.push({ point: tile.point, spot: tile.spot, radius: mark });

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

  if (covers) {
    context.globalAlpha *= clamp01((LANDMARK_ZOOM - view.k) / 0.9);
    const clipText = (text: string, max: number) => {
      if (context.measureText(text).width <= max) return text;
      let shortened = text;
      while (shortened && context.measureText(`${shortened}…`).width > max)
        shortened = shortened.slice(0, -1);
      return `${shortened}…`;
    };
    for (const { point, at, labelX, width: labelWidth } of visibleLandmarks(
      scene.landmarks,
      view,
      size,
      highlightGenre,
      selectedIds,
    )) {
      const active = point.id === hoveredId || point.id === nowPlayingId;
      if (active) {
        context.beginPath();
        context.roundRect(labelX - labelWidth / 2, at.y + 20, labelWidth, 45, 7);
        context.fillStyle = rgba(palette.card, 0.92);
        context.fill();
        context.strokeStyle = rgba(palette.primary, 0.6);
        context.lineWidth = 1;
        context.stroke();
      }
      context.textAlign = "center";
      context.font = `600 13px ${palette.font}`;
      context.lineWidth = 4;
      context.strokeStyle = rgba(palette.card, 0.95);
      const artist = clipText(point.artist || point.title, labelWidth - 16);
      context.strokeText(artist, labelX, at.y + 34);
      context.fillStyle = rgba(palette.ink, 1);
      context.fillText(artist, labelX, at.y + 34);
      context.font = `400 12px ${palette.font}`;
      const title = clipText(point.title, labelWidth - 16);
      context.strokeText(title, labelX, at.y + 51);
      context.fillStyle = rgba(palette.ink, 0.76);
      context.fillText(title, labelX, at.y + 51);
      const image = cover(point);
      context.fillStyle = rgba(palette.card, 1);
      dots([at], 21);
      if (image) context.drawImage(image, at.x - 19, at.y - 19, 38, 38);
      context.strokeStyle = rgba(active ? palette.primary : palette.ink, active ? 1 : 0.5);
      context.lineWidth = active ? 2.5 : 1.5;
      rings([at], 21);
    }
    context.textAlign = "left";
  }
  context.globalAlpha = clamp01((intro - 0.35) / 0.4);

  const placed: { left: number; right: number; top: number; bottom: number }[] = [];

  for (const label of [...labels].sort(
    (a, b) => Number(b.strong ?? false) - Number(a.strong ?? false),
  )) {
    const spot = screen(label);
    const size = label.strong ? 14 : 12;
    context.font = `${label.strong ? 700 : 600} ${size}px ${palette.font}`;

    const plate = context.measureText(label.text).width + 20;
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
      context.strokeStyle = rgba(palette.ink, 0.16);
      context.stroke();
    }

    context.fillStyle = label.strong ? rgba(palette.onPrimary, 1) : rgba(palette.ink, 1);
    context.fillText(label.text, left + 10, y + 0.5);
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

// SPDX-License-Identifier: AGPL-3.0-only
import type { MapPoint } from "@/lib/types";
import type { Bounds } from "@/lib/libraryMap";
import type { Rgb } from "@/lib/cssColor";

const FIELD_SIZE = 192;
export interface MapStar {
  tint: number;
  size: number;
  light: number;
  beacon: boolean;
}
export interface Starfield {
  stars: MapStar[];
  bounds: Bounds;
  density: Float32Array;
  size: number;
}

const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5);
function hash(id: string): number {
  let value = 2166136261;
  for (const c of id) value = Math.imul(value ^ c.charCodeAt(0), 16777619);
  return (value >>> 0) / 4294967296;
}

function blur(source: Float32Array, radius: number): Float32Array {
  const horizontal = new Float32Array(source.length),
    output = new Float32Array(source.length);
  for (let y = 0; y < FIELD_SIZE; y++)
    for (let x = 0; x < FIELD_SIZE; x++) {
      let sum = 0;
      for (let d = -radius; d <= radius; d++)
        if (x + d >= 0 && x + d < FIELD_SIZE) sum += source[y * FIELD_SIZE + x + d];
      horizontal[y * FIELD_SIZE + x] = sum / (radius * 2 + 1);
    }
  for (let y = 0; y < FIELD_SIZE; y++)
    for (let x = 0; x < FIELD_SIZE; x++) {
      let sum = 0;
      for (let d = -radius; d <= radius; d++)
        if (y + d >= 0 && y + d < FIELD_SIZE) sum += horizontal[(y + d) * FIELD_SIZE + x];
      output[y * FIELD_SIZE + x] = sum / (radius * 2 + 1);
    }
  return output;
}

export function buildStarfield(points: MapPoint[]): Starfield {
  const finite = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const point of finite) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (!finite.length) {
    minX = minY = 0;
    maxX = maxY = 1;
  }
  const span = Math.max(0.1, maxX - minX, maxY - minY),
    padding = span * 0.1;
  const bounds = {
    minX: minX - padding,
    maxX: maxX + padding,
    minY: minY - padding,
    maxY: maxY + padding,
  };
  const width = bounds.maxX - bounds.minX,
    height = bounds.maxY - bounds.minY;
  const grid = new Float32Array(FIELD_SIZE * FIELD_SIZE);
  for (const point of finite) {
    const x = Math.min(FIELD_SIZE - 1, Math.floor(((point.x - bounds.minX) / width) * FIELD_SIZE));
    const y = Math.min(FIELD_SIZE - 1, Math.floor(((point.y - bounds.minY) / height) * FIELD_SIZE));
    grid[y * FIELD_SIZE + x]++;
  }
  const fine = blur(blur(grid, 3), 3),
    broad = blur(fine, 9);
  let maximum = 0;
  for (let i = 0; i < fine.length; i++) {
    fine[i] = fine[i] * 0.65 + broad[i] * 0.35;
    maximum = Math.max(maximum, fine[i]);
  }
  if (maximum) for (let i = 0; i < fine.length; i++) fine[i] = Math.sqrt(fine[i] / maximum);
  const stars = points.map((point) => {
    const value = hash(point.id);
    const x = clamp((point.x - bounds.minX) / width),
      y = clamp((point.y - bounds.minY) / height);
    return {
      tint: Math.min(5, Math.floor(clamp(x * 0.6 + y * 0.4) * 6)),
      size: value < 0.08 ? 1.35 : value < 0.35 ? 1 : 0.75,
      light: value < 0.08 ? 1 : value < 0.35 ? 0.82 : 0.62,
      beacon: value < 0.035,
    };
  });
  return { stars, bounds, density: fine, size: FIELD_SIZE };
}

export function stellarColours(primary: Rgb, light: boolean): Rgb[] {
  const anchors: Rgb[] = light
    ? [
        [92, 119, 142],
        [109, 106, 151],
        [155, 115, 76],
      ]
    : [
        [135, 188, 224],
        [173, 160, 222],
        [236, 199, 151],
      ];
  return Array.from({ length: 6 }, (_, i) => {
    const t = (i / 5) * 2,
      index = Math.min(1, Math.floor(t)),
      share = t - index;
    return anchors[index].map((v, c) =>
      Math.round((v * (1 - share) + anchors[index + 1][c] * share) * 0.8 + primary[c] * 0.2),
    ) as Rgb;
  });
}

const textures = new WeakMap<Starfield, { key: string; canvas: HTMLCanvasElement }>();
export function nebulaTexture(field: Starfield, colours: Rgb[], light: boolean): HTMLCanvasElement {
  const key = colours.join() + light;
  const cached = textures.get(field);
  if (cached?.key === key) return cached.canvas;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = field.size;
  const ctx = canvas.getContext("2d")!;
  const pixels = ctx.createImageData(field.size, field.size);
  for (let y = 0; y < field.size; y++)
    for (let x = 0; x < field.size; x++) {
      const i = y * field.size + x;
      const position = ((x / field.size) * 0.6 + (y / field.size) * 0.4) * 5;
      const left = Math.floor(position),
        share = position - left;
      for (let c = 0; c < 3; c++)
        pixels.data[i * 4 + c] = Math.round(
          colours[left][c] * (1 - share) + colours[Math.min(5, left + 1)][c] * share,
        );
      pixels.data[i * 4 + 3] = Math.round(field.density[i] * (light ? 25 : 45));
    }
  ctx.putImageData(pixels, 0, 0);
  textures.set(field, { key, canvas });
  return canvas;
}

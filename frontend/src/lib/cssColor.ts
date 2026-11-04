// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

export type Rgb = [number, number, number];

export function rgbOf(color: string, fallback: Rgb = [128, 128, 128]): Rgb {
  const value = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];

  if (hex) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16)) as Rgb;
  }

  const channels = /rgba?\(([^)]+)\)/
    .exec(value)?.[1]
    .split(/[\s,/]+/)
    .map(Number);
  return channels && channels.length >= 3 ? [channels[0], channels[1], channels[2]] : fallback;
}

export function rgba([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha)).toFixed(3)})`;
}

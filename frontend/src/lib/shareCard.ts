// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { rgbOf, rgba, type Rgb } from "@/lib/cssColor";

export type ShareCardFormat = "story" | "square";

export const SHARE_CARD_SIZES: Record<ShareCardFormat, { width: number; height: number }> = {
  story: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
};

export interface ShareCardInput {
  title: string;
  artist: string;
  album?: string | null;
  coverUrl: string | null;
  lyric?: string | null;
  peaks?: number[] | null;
  progress?: number;
  caption: string;
}

export function wrapLines(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (measure(candidate) <= maxWidth || !line) {
      line = candidate;
      continue;
    }

    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);

  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]}…`;
  while (last.length > 1 && measure(last) > maxWidth) last = `${last.slice(0, -2).trimEnd()}…`;
  kept[maxLines - 1] = last;

  return kept;
}

interface Palette {
  background: Rgb;
  foreground: Rgb;
  muted: Rgb;
  primary: Rgb;
  display: string;
  sans: string;
}

function readPalette(): Palette {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name);

  return {
    background: rgbOf(read("--background"), [28, 23, 20]),
    foreground: rgbOf(read("--foreground"), [239, 228, 210]),
    muted: rgbOf(read("--muted-foreground"), [179, 165, 149]),
    primary: rgbOf(read("--primary"), [217, 164, 65]),
    display: read("--font-unbounded").trim() || "sans-serif",
    sans: read("--font-onest").trim() || "sans-serif",
  };
}

async function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null;

  const image = new Image();
  image.decoding = "async";
  image.src = url;

  try {
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

function coverCrop(image: HTMLImageElement, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

function blurredBackdrop(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const small = document.createElement("canvas");
  small.width = 24;
  small.height = Math.max(1, Math.round((24 * height) / width));
  const shrink = small.getContext("2d")!;
  const crop = coverCrop(image, small.width, small.height);
  shrink.drawImage(image, crop.x, crop.y, crop.w, crop.h);

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(small, -width * 0.05, -height * 0.05, width * 1.1, height * 1.1);
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, size, size, radius);
}

function drawRecord(
  context: CanvasRenderingContext2D,
  centreX: number,
  centreY: number,
  radius: number,
  image: HTMLImageElement | null,
  palette: Palette,
) {
  context.save();
  context.beginPath();
  context.arc(centreX, centreY, radius, 0, Math.PI * 2);
  context.fillStyle = "#121010";
  context.shadowColor = "rgba(0, 0, 0, 0.55)";
  context.shadowBlur = 40;
  context.fill();
  context.restore();

  context.save();
  context.lineWidth = 1.2;
  for (let groove = radius * 0.36; groove < radius * 0.97; groove += 5) {
    context.beginPath();
    context.arc(centreX, centreY, groove, 0, Math.PI * 2);
    context.strokeStyle = groove % 15 < 5 ? "rgba(255, 255, 255, 0.05)" : "rgba(0, 0, 0, 0.35)";
    context.stroke();
  }
  context.restore();

  const label = radius * 0.33;
  context.save();
  context.beginPath();
  context.arc(centreX, centreY, label, 0, Math.PI * 2);
  context.clip();
  if (image) {
    context.drawImage(image, centreX - label, centreY - label, label * 2, label * 2);
  } else {
    context.fillStyle = rgba(palette.primary, 1);
    context.fill();
  }
  context.restore();

  context.beginPath();
  context.arc(centreX, centreY, label * 0.12, 0, Math.PI * 2);
  context.fillStyle = rgba(palette.background, 1);
  context.fill();
}

function drawWaveform(
  context: CanvasRenderingContext2D,
  peaks: number[],
  x: number,
  y: number,
  width: number,
  height: number,
  progress: number,
  palette: Palette,
) {
  const bar = width / peaks.length;

  peaks.forEach((peak, index) => {
    const h = Math.max(0.06, peak / 255) * height;
    const played = (index + 0.5) / peaks.length <= progress;
    context.fillStyle = played ? rgba(palette.primary, 1) : rgba(palette.foreground, 0.28);
    context.fillRect(x + index * bar + bar * 0.18, y + (height - h) / 2, bar * 0.64, h);
  });
}

export async function renderShareCard(
  input: ShareCardInput,
  format: ShareCardFormat,
): Promise<Blob> {
  const { width, height } = SHARE_CARD_SIZES[format];
  const palette = readPalette();

  await Promise.allSettled([
    document.fonts.load(`500 80px ${palette.display}`),
    document.fonts.load(`500 40px ${palette.sans}`),
  ]);
  const image = await loadImage(input.coverUrl);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;

  context.fillStyle = rgba(palette.background, 1);
  context.fillRect(0, 0, width, height);
  if (image) blurredBackdrop(context, image, width, height);

  const veil = context.createLinearGradient(0, 0, 0, height);
  veil.addColorStop(0, rgba(palette.background, 0.45));
  veil.addColorStop(0.55, rgba(palette.background, 0.62));
  veil.addColorStop(1, rgba(palette.background, 0.92));
  context.fillStyle = veil;
  context.fillRect(0, 0, width, height);

  const story = format === "story";
  const margin = 96;
  const cover = story ? 640 : 420;
  const coverX = story ? margin : margin;
  const coverY = story ? 300 : margin + 20;

  drawRecord(context, coverX + cover * 0.82, coverY + cover / 2, cover * 0.47, image, palette);

  context.save();
  roundedRect(context, coverX, coverY, cover, 18);
  context.shadowColor = "rgba(0, 0, 0, 0.5)";
  context.shadowBlur = 60;
  context.shadowOffsetY = 24;
  context.fillStyle = rgba(palette.background, 1);
  context.fill();
  context.restore();

  context.save();
  roundedRect(context, coverX, coverY, cover, 18);
  context.clip();
  if (image) {
    const crop = coverCrop(image, cover, cover);
    context.drawImage(image, coverX + crop.x, coverY + crop.y, crop.w, crop.h);
  } else {
    context.fillStyle = rgba(palette.muted, 0.3);
    context.fillRect(coverX, coverY, cover, cover);
  }
  context.restore();

  const textX = margin;
  const textWidth = width - margin * 2;
  let cursor = story ? coverY + cover + 150 : coverY + cover + 110;

  context.textBaseline = "alphabetic";
  context.fillStyle = rgba(palette.foreground, 1);

  const titleSize = story ? 84 : 64;
  context.font = `500 ${titleSize}px ${palette.display}`;
  for (const line of wrapLines(
    (text) => context.measureText(text).width,
    input.title,
    textWidth,
    2,
  )) {
    context.fillText(line, textX, cursor);
    cursor += titleSize * 1.12;
  }

  context.font = `500 ${story ? 42 : 34}px ${palette.sans}`;
  context.fillStyle = rgba(palette.muted, 1);
  const byline = [input.artist, input.album].filter(Boolean).join(" — ");
  for (const line of wrapLines((text) => context.measureText(text).width, byline, textWidth, 2)) {
    context.fillText(line, textX, cursor);
    cursor += story ? 54 : 44;
  }

  if (input.lyric && story) {
    cursor += 70;
    context.font = `500 52px ${palette.display}`;
    context.fillStyle = rgba(palette.primary, 1);
    const lines = wrapLines(
      (text) => context.measureText(text).width,
      `“${input.lyric}”`,
      textWidth,
      3,
    );
    for (const line of lines) {
      context.fillText(line, textX, cursor);
      cursor += 66;
    }
  }

  if (input.peaks && input.peaks.length > 0) {
    const waveHeight = story ? 120 : 80;
    const waveY = story ? height - 330 : height - 250;
    drawWaveform(
      context,
      input.peaks,
      textX,
      waveY,
      textWidth,
      waveHeight,
      input.progress ?? 0,
      palette,
    );
  }

  context.font = `500 34px ${palette.display}`;
  context.fillStyle = rgba(palette.foreground, 1);
  context.fillText("Caimack", textX, height - 96);

  context.font = `500 30px ${palette.sans}`;
  context.fillStyle = rgba(palette.muted, 1);
  context.textAlign = "right";
  context.fillText(input.caption, width - margin, height - 96);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/png",
    ),
  );
}

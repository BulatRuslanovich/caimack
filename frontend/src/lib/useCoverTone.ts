// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useCallback, useState, useSyncExternalStore, type CSSProperties } from "react";
import { coverTone, TONE_SAMPLE_EDGE, type CoverTone } from "./coverTone";

const tones = new Map<string, CoverTone | null>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

const MAX_CACHED = 400;

function remember(url: string, tone: CoverTone | null): void {
  if (tones.size >= MAX_CACHED) tones.delete(tones.keys().next().value!);
  tones.set(url, tone);
  listeners.forEach((listener) => listener());
}

function sample(url: string): Promise<void> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;

  return image
    .decode()
    .then(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = TONE_SAMPLE_EDGE;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return remember(url, null);

      context.drawImage(image, 0, 0, TONE_SAMPLE_EDGE, TONE_SAMPLE_EDGE);
      const { data } = context.getImageData(0, 0, TONE_SAMPLE_EDGE, TONE_SAMPLE_EDGE);
      remember(url, coverTone(data));
    })
    .catch(() => remember(url, null))
    .finally(() => pending.delete(url));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCoverTone(url: string | null | undefined): CoverTone | null | undefined {
  const tone = useSyncExternalStore(
    subscribe,
    () => (url ? tones.get(url) : null),
    () => undefined,
  );

  if (tone === undefined) request(url);

  return tone;
}

function request(url: string | null | undefined): void {
  if (url && !tones.has(url) && !pending.has(url) && typeof window !== "undefined") {
    pending.set(url, sample(url));
  }
}

export function useVividTone(urls: (string | null | undefined)[]): CoverTone | null | undefined {
  const tone = useSyncExternalStore(
    subscribe,
    () => {
      let best: CoverTone | null | undefined = null;
      for (const url of urls) {
        if (!url) continue;
        const tone = tones.get(url);
        if (tone === undefined) return undefined;
        if (tone && (!best || tone.chroma > best.chroma)) best = tone;
      }
      return best;
    },
    () => undefined,
  );

  urls.forEach(request);

  return tone;
}

export function toneStyle(tone: CoverTone | null | undefined): CSSProperties {
  if (!tone) return { ["--tone-a" as string]: 0 };

  return {
    ["--tone-h" as string]: tone.hue,
    ["--tone-c" as string]: tone.chroma,
    ["--tone-a" as string]: 1,
  };
}

// Keep the last sampled colour while the next cover loads. Animating a colour
// (rather than its hue number) also avoids travelling around the colour wheel.
export function useCoverLight(url: string | null | undefined): CSSProperties {
  const sampled = useCoverTone(url);
  const [settled, setSettled] = useState(sampled ?? null);
  if (sampled !== undefined && sampled !== settled) setSettled(sampled);
  const tone = sampled === undefined ? settled : sampled;

  return {
    ["--cover-light" as string]: url
      ? `oklch(var(--cover-light-l) calc(min(${tone?.chroma ?? 0} * 1.5, var(--tone-c-max)) * var(--tone-strength)) ${tone?.hue ?? 0} / calc(var(--tone-on) * ${tone ? 1 : 0.3}))`
      : "transparent",
  };
}

export function useTone<T extends Element>(source: string | null | undefined | (string | null)[]) {
  const [seen, setSeen] = useState(false);

  const ref = useCallback(
    (element: T | null) => {
      if (!element || seen) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) return;
          setSeen(true);
          observer.disconnect();
        },
        { rootMargin: "200px" },
      );
      observer.observe(element);
      return () => observer.disconnect();
    },
    [seen],
  );

  const urls = Array.isArray(source) ? source : [source];
  const tone = useVividTone(seen ? urls : []);

  return { ref, "data-tone": "", style: toneStyle(tone) };
}

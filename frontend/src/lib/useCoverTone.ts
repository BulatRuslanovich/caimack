// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createCoverToneCache, type CoverTones, type CoverToneKind } from "./coverToneCache";
import {
  backdropTone,
  BACKDROP_SAMPLE_EDGE,
  coverTone,
  TONE_SAMPLE_EDGE,
  type BackdropTone,
  type CoverTone,
} from "./coverTone";

function sample(url: string, kind: CoverToneKind): Promise<CoverTones> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;

  return image.decode().then(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = kind === "backdrop" ? BACKDROP_SAMPLE_EDGE : TONE_SAMPLE_EDGE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas sampling is unavailable");

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    return kind === "backdrop" ? { backdrop: backdropTone(data) } : { accent: coverTone(data) };
  });
}

const cache = createCoverToneCache(sample);

export function useCoverTone(url: string | null | undefined): CoverTone | null | undefined;
export function useCoverTone(
  url: string | null | undefined,
  kind: "accent",
): CoverTone | null | undefined;
export function useCoverTone(
  url: string | null | undefined,
  kind: "backdrop",
): BackdropTone | null | undefined;
export function useCoverTone(
  url: string | null | undefined,
  kind: keyof CoverTones = "accent",
): CoverTone | null | undefined {
  const tone = useSyncExternalStore(
    cache.subscribe,
    () => {
      if (!url) return null;
      return cache.get(url, kind);
    },
    () => undefined,
  );

  useEffect(() => {
    if (url && tone === undefined) void cache.load(url, kind);
  }, [url, kind, tone]);

  return tone;
}

export function useVividTone(urls: (string | null | undefined)[]): CoverTone | null | undefined {
  const tone = useSyncExternalStore(
    cache.subscribe,
    () => {
      let best: CoverTone | null | undefined = null;
      for (const url of urls) {
        if (!url) continue;
        const tone = cache.get(url, "accent");
        if (tone === undefined) return undefined;
        if (tone && (!best || tone.chroma > best.chroma)) best = tone;
      }
      return best;
    },
    () => undefined,
  );

  useEffect(() => {
    if (tone === undefined)
      urls.forEach((url) => {
        if (url) void cache.load(url, "accent");
      });
  }, [urls, tone]);

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

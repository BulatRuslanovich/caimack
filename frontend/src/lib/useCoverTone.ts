// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createCoverToneCache, type CoverTones, type CoverToneKind } from "./coverToneCache";
import { PLAYER_BACKDROP, playerBackdropTone } from "./visuals/playerBackdrop";
import {
  backdropTone,
  BACKDROP_SAMPLE_EDGE,
  coverTone,
  TONE_SAMPLE_EDGE,
  type BackdropTone,
  type CoverTone,
} from "./coverTone";

async function sample(url: string, kind: CoverToneKind): Promise<CoverTones> {
  const image = new Image();
  image.decoding = "async";
  image.crossOrigin = "anonymous";
  image.src = url;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          image.src = "";
          reject(new Error("Cover sampling timed out"));
        }, PLAYER_BACKDROP.loadTimeoutMs);
      }),
    ]);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height =
      kind === "player"
        ? PLAYER_BACKDROP.sampleEdge
        : kind === "backdrop"
          ? BACKDROP_SAMPLE_EDGE
          : TONE_SAMPLE_EDGE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas sampling is unavailable");

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    if (kind === "player") return { player: playerBackdropTone(data) };
    return kind === "backdrop" ? { backdrop: backdropTone(data) } : { accent: coverTone(data) };
  } finally {
    clearTimeout(timeout);
  }
}

const cache = createCoverToneCache(sample);

export function useCoverTone(url: string | null | undefined): CoverTone | null | undefined;
export function useCoverTone(
  url: string | null | undefined,
  kind: "accent",
): CoverTone | null | undefined;
export function useCoverTone(
  url: string | null | undefined,
  kind: "backdrop" | "player",
): BackdropTone | null | undefined;
export function useCoverTone(
  url: string | null | undefined,
  kind: keyof CoverTones = "accent",
): CoverTone | null | undefined {
  let source = url;
  // Album headers request full-size art; sample the same thumbnail as the player.
  if (kind === "player" && url && /\/api\/.*\/(cover|image)(\?|$)/.test(url)) {
    const [path, query = ""] = url.split("?");
    const params = new URLSearchParams(query);
    params.set("size", "thumb");
    source = `${path}?${params}`;
  }
  const tone = useSyncExternalStore(
    cache.subscribe,
    () => {
      if (!source) return null;
      return cache.get(source, kind);
    },
    () => undefined,
  );

  useEffect(() => {
    if (source && tone === undefined) void cache.load(source, kind);
  }, [source, kind, tone]);

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
  // The current-track interface and fullscreen player share one cached selection.
  const sampled = useCoverTone(url, "player");
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

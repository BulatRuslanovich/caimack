// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { CSSProperties } from "react";
import type { BackdropTone } from "@/lib/coverTone";
import type { ArtworkDirection } from "@/lib/playback/useArtworkNavigation";
import { useCoverTone } from "@/lib/useCoverTone";
import { useArtworkTransition } from "@/lib/visuals/useArtworkTransition";
import { useArtworkScene } from "./ArtworkScene";

function paletteStyle(tone: BackdropTone | null): CSSProperties {
  const lightness = tone ? Math.max(0.27, Math.min(0.44, tone.lightness * 0.85)) : 0.44;
  const chroma = tone
    ? Math.min(tone.chroma * Math.max(0.6, Math.min(1, 1 - (tone.lightness - 0.4) * 1.5)), 0.1)
    : 0;
  return {
    "--art-color": tone
      ? `oklch(var(--art-lightness, ${lightness}) ${chroma} ${tone.hue})`
      : "oklch(var(--art-lightness, 0.44) 0 0)",
  } as CSSProperties;
}

export function ArtBackdrop({
  src,
  mode,
  direction = "next",
}: {
  src: string | null;
  mode: "stage" | "header";
  direction?: ArtworkDirection;
}) {
  if (src === null && mode === "header") return null;
  return <CoverBackdrop src={src} mode={mode} direction={direction} />;
}

export function PlayerBackdrop() {
  const scene = useArtworkScene();
  return <BackdropLayers {...scene} mode="stage" />;
}

function CoverBackdrop({
  src,
  mode,
  direction,
}: {
  src: string | null;
  mode: "stage" | "header";
  direction: ArtworkDirection;
}) {
  const tone = useCoverTone(src, "backdrop");
  const scene = useArtworkTransition({ key: src ?? "neutral", item: src, src, tone, direction });
  return <BackdropLayers {...scene} mode={mode} />;
}

function BackdropLayers({
  current,
  previous,
  direction,
  onAnimationEnd,
  mode,
}: Pick<
  ReturnType<typeof useArtworkTransition<unknown>>,
  "current" | "previous" | "direction" | "onAnimationEnd"
> & { mode: "stage" | "header" }) {
  return (
    <div
      aria-hidden="true"
      className="art-backdrop"
      data-mode={mode}
      data-direction={direction}
      style={paletteStyle(current.tone)}
    >
      {previous && (
        <div
          key={previous.key}
          className="art-backdrop-palette"
          data-state="leaving"
          style={paletteStyle(previous.tone)}
        />
      )}
      <div
        key={current.key}
        className="art-backdrop-palette"
        data-state={previous ? "entering" : "settled"}
        style={paletteStyle(current.tone)}
        onAnimationEnd={onAnimationEnd}
      />
      <div className="art-backdrop-grain" />
    </div>
  );
}

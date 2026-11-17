// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useMemo, type CSSProperties } from "react";
import type { BackdropTone } from "@/lib/coverTone";
import type { ArtworkDirection } from "@/lib/playback/useArtworkNavigation";
import { useCoverTone } from "@/lib/useCoverTone";
import { useArtworkTransition } from "@/lib/visuals/useArtworkTransition";
import { backdropPalette } from "@/lib/visuals/backdropPalette";
import { PLAYER_BACKDROP, backdropRgb, playerBackdropSurface } from "@/lib/visuals/playerBackdrop";
import { useArtworkScene } from "./ArtworkScene";

function paletteStyle(
  tone: BackdropTone | null,
  mode: "stage" | "header" | "player",
): CSSProperties {
  if (mode === "player" || mode === "header") {
    const { top, bottom } = playerBackdropSurface(tone);
    return {
      "--art-color": `rgb(${backdropRgb(top).join(" ")})`,
      "--art-bottom": `rgb(${backdropRgb(bottom).join(" ")})`,
      "--art-duration": `${PLAYER_BACKDROP.transitionMs}ms`,
    } as CSSProperties;
  }
  const { lightness, chroma, hue } = backdropPalette(tone);
  return {
    "--art-color": `oklch(var(--art-lightness, ${lightness}) ${chroma} ${hue})`,
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
  return <BackdropLayers {...scene} mode="player" />;
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
  const tone = useCoverTone(src, mode === "header" ? "player" : "backdrop");
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
> & { mode: "stage" | "header" | "player" }) {
  const currentStyle = useMemo(() => paletteStyle(current.tone, mode), [current.tone, mode]);
  const previousStyle = useMemo(
    () => paletteStyle(previous?.tone ?? null, mode),
    [previous?.tone, mode],
  );
  return (
    <div
      aria-hidden="true"
      className="art-backdrop"
      data-mode={mode}
      data-direction={direction}
      style={currentStyle}
    >
      {previous && (
        <div
          key={previous.key}
          className="art-backdrop-palette"
          data-state="leaving"
          style={previousStyle}
        />
      )}
      <div
        key={current.key}
        className="art-backdrop-palette"
        data-state={previous ? "entering" : "settled"}
        style={currentStyle}
        onAnimationEnd={onAnimationEnd}
      />
      {mode !== "player" && <div className="art-backdrop-grain" />}
    </div>
  );
}

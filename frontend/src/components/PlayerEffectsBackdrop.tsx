// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { usePlayerEffects } from "@/lib/playerEffects";
import { useArtworkScene } from "./ArtworkScene";
import dynamic from "next/dynamic";
import { LavaBackdrop } from "./LavaBackdrop";

const EffectCanvas = dynamic(() => import("./EffectCanvas").then((m) => m.EffectCanvas), {
  ssr: false,
});

export function PlayerEffectsBackdrop({ playing }: { playing: boolean }) {
  const { effect, intensity, sensitivity } = usePlayerEffects();
  const { current, previous, direction, trackId, onAnimationEnd } = useArtworkScene();
  if (effect === "off" || intensity === 0) return null;
  return (
    <div
      className="player-effects-transition"
      data-direction={direction}
      aria-hidden="true"
      style={effect === "lava" ? { opacity: intensity / 100 } : undefined}
    >
      {previous && (
        <div key={previous.key} className="player-effects-transition-layer" data-state="leaving">
          {effect === "lava" ? (
            <LavaBackdrop src={previous.src} frozen />
          ) : (
            <EffectCanvas
              effect={effect}
              intensity={intensity}
              sensitivity={sensitivity}
              track={previous.item}
              playing={false}
              frozen
            />
          )}
        </div>
      )}
      <div
        key={current.key}
        className="player-effects-transition-layer"
        data-state={previous ? "entering" : "settled"}
        onAnimationEnd={onAnimationEnd}
      >
        {effect === "lava" ? (
          <LavaBackdrop src={current.src} />
        ) : (
          <EffectCanvas
            effect={effect}
            intensity={intensity}
            sensitivity={sensitivity}
            track={current.item}
            playing={playing && current.item.id === trackId}
            frozen={current.item.id !== trackId}
          />
        )}
      </div>
    </div>
  );
}

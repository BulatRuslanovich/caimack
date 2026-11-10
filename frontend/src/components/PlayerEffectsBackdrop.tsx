// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { usePlayerEffects } from "@/lib/playerEffects";
import type { Track } from "@/lib/types";
import dynamic from "next/dynamic";

const EffectCanvas = dynamic(() => import("./EffectCanvas").then((m) => m.EffectCanvas), {
  ssr: false,
});

export function PlayerEffectsBackdrop({ track, playing }: { track: Track; playing: boolean }) {
  const { effect, intensity, sensitivity } = usePlayerEffects();
  if (effect === "off" || intensity === 0) return null;
  return (
    <EffectCanvas
      effect={effect}
      intensity={intensity}
      sensitivity={sensitivity}
      track={track}
      playing={playing}
    />
  );
}

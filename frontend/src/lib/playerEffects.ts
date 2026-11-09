// SPDX-License-Identifier: AGPL-3.0-only

import { useSyncExternalStore } from "react";
import { readStoredJson, writeStoredJson } from "@/lib/storage";

export const PLAYER_EFFECTS = ["aurora", "glass", "ink"] as const;
export type PlayerEffect = (typeof PLAYER_EFFECTS)[number];
export type PlayerEffectChoice = PlayerEffect | "off";
export interface PlayerEffectsState {
  effect: PlayerEffectChoice;
  intensity: number;
  sensitivity: number;
}
const KEY = "music-streaming.player-effects";
const DEFAULT: PlayerEffectsState = { effect: "glass", intensity: 65, sensitivity: 65 };
let state = DEFAULT;
let loaded = false;
const listeners = new Set<() => void>();

export function playerEffectsState(value: unknown): PlayerEffectsState {
  if (!value || typeof value !== "object") return DEFAULT;
  const saved = value as Partial<PlayerEffectsState>;
  return {
    effect:
      saved.effect === "off" || PLAYER_EFFECTS.includes(saved.effect as PlayerEffect)
        ? saved.effect!
        : DEFAULT.effect,
    intensity:
      typeof saved.intensity === "number" && Number.isFinite(saved.intensity)
        ? Math.max(0, Math.min(100, saved.intensity))
        : DEFAULT.intensity,
    sensitivity:
      typeof saved.sensitivity === "number" && Number.isFinite(saved.sensitivity)
        ? Math.max(0, Math.min(100, saved.sensitivity))
        : DEFAULT.sensitivity,
  };
}

function current(): PlayerEffectsState {
  if (!loaded && typeof window !== "undefined") {
    state = playerEffectsState(readStoredJson(KEY));
    loaded = true;
  }
  return state;
}

export function setPlayerEffects(changes: Partial<PlayerEffectsState>): void {
  state = playerEffectsState({ ...current(), ...changes });
  writeStoredJson(KEY, state);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePlayerEffects(): PlayerEffectsState {
  return useSyncExternalStore(subscribe, current, () => DEFAULT);
}

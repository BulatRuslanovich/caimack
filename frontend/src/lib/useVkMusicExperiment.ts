// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useSyncExternalStore } from "react";
import { readStored, writeStored } from "@/lib/storage";

const KEY = "music-streaming.vkMusic";
const listeners = new Set<() => void>();

function subscribeVkMusicExperiment(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function vkMusicEnabled(): boolean {
  return readStored(KEY) === "on";
}

export function setVkMusicEnabled(enabled: boolean): void {
  writeStored(KEY, enabled ? "on" : null);
  for (const listener of listeners) listener();
}

export function useVkMusicExperiment(): boolean {
  return useSyncExternalStore(subscribeVkMusicExperiment, vkMusicEnabled, () => false);
}

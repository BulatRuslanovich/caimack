// SPDX-License-Identifier: AGPL-3.0-only

import { useSyncExternalStore } from "react";
import { readStored, writeStored } from "@/lib/storage";

const KEY = "music-streaming.tatar-mafia";
const listeners = new Set<() => void>();

export function tatarMafiaEnabled(): boolean {
  return readStored(KEY) === "on";
}

export function setTatarMafia(enabled: boolean): void {
  writeStored(KEY, enabled ? "on" : "off");
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTatarMafia(): boolean {
  return useSyncExternalStore(subscribe, tatarMafiaEnabled, () => false);
}

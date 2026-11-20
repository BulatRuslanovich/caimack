// SPDX-License-Identifier: AGPL-3.0-only

import { useSyncExternalStore } from "react";
import { readStored, writeStored } from "@/lib/storage";

const KEY = "caimack.experiments.audiobooks";
const listeners = new Set<() => void>();

function enabled(): boolean {
  return readStored(KEY) === "on";
}

export function setAudiobookExperiment(value: boolean): void {
  writeStored(KEY, value ? "on" : "off");
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", storage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", storage);
  };
}

export function useAudiobookExperiment(): boolean {
  return useSyncExternalStore(subscribe, enabled, () => false);
}

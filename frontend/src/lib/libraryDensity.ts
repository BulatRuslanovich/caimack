// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { useSyncExternalStore } from "react";
import { readStored, writeStored } from "./storage";

export const DENSITY_KEY = "music-streaming.library-density";
export const LIBRARY_DENSITIES = ["compact", "comfortable", "spacious"] as const;
export type LibraryDensity = (typeof LIBRARY_DENSITIES)[number];
const listeners = new Set<() => void>();

function current(): LibraryDensity {
  const saved = readStored(DENSITY_KEY);
  return saved === "compact" || saved === "spacious" ? saved : "comfortable";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const changed = (event: StorageEvent) => {
    if (event.key === DENSITY_KEY || event.key === null) {
      document.documentElement.dataset.libraryDensity = current();
      listener();
    }
  };
  window.addEventListener("storage", changed);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", changed);
  };
}

export function setLibraryDensity(value: LibraryDensity) {
  writeStored(DENSITY_KEY, value);
  document.documentElement.dataset.libraryDensity = value;
  for (const listener of listeners) listener();
}

export function useLibraryDensity() {
  return useSyncExternalStore(subscribe, current, () => "comfortable" as const);
}

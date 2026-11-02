// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

import { useSyncExternalStore } from "react";
import { readStored, writeStored } from "./storage";

const VIEW_KEY = "music-streaming.albums-view";
export const ALBUM_VIEWS = ["grid", "crate"] as const;
export type AlbumView = (typeof ALBUM_VIEWS)[number];
const listeners = new Set<() => void>();

function current(): AlbumView {
  return readStored(VIEW_KEY) === "crate" ? "crate" : "grid";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const changed = (event: StorageEvent) => {
    if (event.key === VIEW_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", changed);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", changed);
  };
}

export function setAlbumView(value: AlbumView) {
  writeStored(VIEW_KEY, value);
  for (const listener of listeners) listener();
}

export function useAlbumView() {
  return useSyncExternalStore(subscribe, current, () => "grid" as const);
}

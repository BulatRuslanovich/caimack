// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useSyncExternalStore } from "react";
import { readStored, writeStored } from "./storage";

const KEY = "music-streaming.track-details";
const listeners = new Set<() => void>();
type Detail = "audio" | "tempo";

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTrackDisplay() {
  const saved = useSyncExternalStore(
    subscribe,
    () => readStored(KEY) ?? "",
    () => "",
  );
  const enabled = new Set(saved.split(","));
  return {
    showAudioSpec: enabled.has("audio"),
    showTempoKey: enabled.has("tempo"),
    toggle(detail: Detail) {
      // Read at the time of the action so another tab's choices are preserved.
      const next = new Set((readStored(KEY) ?? "").split(","));
      if (next.has(detail)) next.delete(detail);
      else next.add(detail);
      writeStored(KEY, (["audio", "tempo"] as const).filter((item) => next.has(item)).join(","));
      listeners.forEach((listener) => listener());
    },
  };
}

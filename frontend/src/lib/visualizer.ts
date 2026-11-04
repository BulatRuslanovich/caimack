// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { useSyncExternalStore } from "react";
import { readStored, writeStored } from "@/lib/storage";

const KEY = "music-streaming.visualizer";

const listeners = new Set<() => void>();

function enabled(): boolean {
  return readStored(KEY) !== "off";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setVisualizer(on: boolean): void {
  writeStored(KEY, on ? "on" : "off");
  for (const listener of listeners) listener();
}

export function useVisualizer(): boolean {
  return useSyncExternalStore(subscribe, enabled, () => false);
}

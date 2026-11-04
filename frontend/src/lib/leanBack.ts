// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { useSyncExternalStore } from "react";
import { readStored, writeStored } from "@/lib/storage";

export const LEAN_BACK_IDLE_MS = 3 * 60_000;

const AUTO_KEY = "music-streaming.lean-back-auto";

interface LeanBackState {
  open: boolean;
  auto: boolean;
}

let state: LeanBackState = { open: false, auto: true };
let loaded = false;
const listeners = new Set<() => void>();

const SERVER: LeanBackState = { open: false, auto: false };

function current(): LeanBackState {
  if (!loaded && typeof window !== "undefined") {
    state = { ...state, auto: readStored(AUTO_KEY) !== "false" };
    loaded = true;
  }
  return state;
}

function set(next: Partial<LeanBackState>): void {
  state = { ...current(), ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const leanBack = {
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  setAuto: (auto: boolean) => {
    writeStored(AUTO_KEY, String(auto));
    set({ auto });
  },
};

export function useLeanBack(): LeanBackState {
  return useSyncExternalStore(subscribe, current, () => SERVER);
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useSyncExternalStore } from "react";
import { readStored, writeStored } from "@/lib/storage";

const STORAGE_KEY = "music-streaming.remaining";

const listeners = new Set<() => void>();

let value = false;
let hydrated = false;

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  if (!hydrated) {
    hydrated = true;

    const stored = readStored(STORAGE_KEY) === "1";
    if (stored !== value) {
      value = stored;
      queueMicrotask(notify);
    }
  }

  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function toggleRemainingTime() {
  value = !value;

  writeStored(STORAGE_KEY, value ? "1" : "0");

  notify();
}

export function useRemainingTime(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => value,
    () => false,
  );
}

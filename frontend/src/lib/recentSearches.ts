// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useSyncExternalStore } from "react";
import { readStoredJson, writeStored } from "@/lib/storage";

const STORAGE_KEY = "music-streaming.recent-searches";

const LIMIT = 8;

const NONE: string[] = [];

const listeners = new Set<() => void>();

let value: string[] = NONE;
let hydrated = false;

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  if (!hydrated) {
    hydrated = true;

    const stored = readStoredJson(STORAGE_KEY);
    if (Array.isArray(stored)) {
      value = stored.filter((entry): entry is string => typeof entry === "string").slice(0, LIMIT);
      queueMicrotask(notify);
    }
  }

  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function save(next: string[]) {
  value = next;
  writeStored(STORAGE_KEY, next.length > 0 ? JSON.stringify(next) : null);
  notify();
}

export function rememberSearch(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return;

  const key = trimmed.toLocaleLowerCase();
  save([trimmed, ...value.filter((entry) => entry.toLocaleLowerCase() !== key)].slice(0, LIMIT));
}

export function forgetSearch(query: string) {
  save(value.filter((entry) => entry !== query));
}

export function clearSearches() {
  save(NONE);
}

export function useRecentSearches(): string[] {
  return useSyncExternalStore(
    subscribe,
    () => value,
    () => NONE,
  );
}

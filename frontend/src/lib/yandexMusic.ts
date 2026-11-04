// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { readStored, writeStored } from "@/lib/storage";

const ENABLED_KEY = "music-streaming.yandexMusic";
const TOKEN_KEY = "music-streaming.yandexMusic.token";

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeYandexMusic(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function yandexMusicEnabled(): boolean {
  return readStored(ENABLED_KEY) === "on";
}

export function yandexMusicToken(): string | null {
  return readStored(TOKEN_KEY);
}

export function setYandexMusicEnabled(on: boolean): void {
  writeStored(ENABLED_KEY, on ? "on" : null);
  notify();
}

export function setYandexMusicToken(token: string): void {
  writeStored(TOKEN_KEY, token.trim() || null);
  notify();
}

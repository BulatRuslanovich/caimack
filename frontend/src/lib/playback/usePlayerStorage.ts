// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useEffect, useRef } from "react";
import { CROSSFADE_CHOICES } from "@/lib/playback/crossfade";
import { validRadioSession } from "@/lib/playback/radioSession";
import { readStoredJson, writeStored, writeStoredJson } from "@/lib/storage";
import type { RadioSessionState, RepeatMode } from "@/lib/playback/playerTypes";
import type { Track } from "@/lib/types";

const STORAGE_KEY = "music-streaming.player";

const POSITION_SAVE_INTERVAL_MS = 10_000;

interface PersistedPlayer {
  queue: Track[];
  index: number;
  position: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  crossfade: number;
  smartTransitions: boolean;
  normalizeVolume: boolean;
  autoplay: boolean;
  radioSession?: RadioSessionState | null;
}

export function readPersistedPlayer(userId: string | null): PersistedPlayer | null {
  // The old shared queue has no owner and cannot safely be assigned to a signed-in user.
  writeStored(STORAGE_KEY, null);
  if (!userId) return null;
  const stored = readStoredJson(`${STORAGE_KEY}:${userId}`);
  if (stored === null || typeof stored !== "object") return null;

  const saved = stored as Partial<PersistedPlayer>;
  const queue = Array.isArray(saved.queue) ? saved.queue : [];
  const index = typeof saved.index === "number" ? saved.index : 0;

  return {
    queue,
    index: index >= 0 && index < queue.length ? index : -1,
    position: typeof saved.position === "number" ? saved.position : 0,
    volume: typeof saved.volume === "number" ? saved.volume : 1,
    muted: saved.muted === true,
    shuffle: saved.shuffle === true,
    repeat: saved.repeat === "all" || saved.repeat === "one" ? saved.repeat : "off",
    crossfade: (CROSSFADE_CHOICES as readonly unknown[]).includes(saved.crossfade)
      ? saved.crossfade!
      : 0,
    smartTransitions: saved.smartTransitions !== false,
    normalizeVolume: saved.normalizeVolume === true,
    autoplay: saved.autoplay !== false,
    radioSession: validRadioSession(saved.radioSession) ? saved.radioSession : null,
  };
}

export function usePersistedPlayer(
  userId: string | null,
  snapshot: PersistedPlayer,
  ready: boolean,
  isPlaying: boolean,
) {
  const key = userId ? `${STORAGE_KEY}:${userId}` : null;
  const latest = useRef(snapshot);

  useEffect(() => {
    latest.current = snapshot;
  });

  const {
    queue,
    index,
    volume,
    muted,
    shuffle,
    repeat,
    crossfade,
    smartTransitions,
    normalizeVolume,
    autoplay,
    radioSession,
  } = snapshot;

  useEffect(() => {
    if (ready && key) writeStoredJson(key, latest.current);
  }, [
    ready,
    key,
    queue,
    index,
    volume,
    muted,
    shuffle,
    repeat,
    crossfade,
    smartTransitions,
    normalizeVolume,
    autoplay,
    radioSession,
  ]);

  useEffect(() => {
    if (!ready || !key) return;

    const save = () => writeStoredJson(key, latest.current);
    window.addEventListener("pagehide", save);

    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [ready, key]);

  useEffect(() => {
    if (!ready || !isPlaying || !key) return;

    const timer = window.setInterval(
      () => writeStoredJson(key, latest.current),
      POSITION_SAVE_INTERVAL_MS,
    );

    return () => {
      window.clearInterval(timer);
      writeStoredJson(key, latest.current);
    };
  }, [ready, isPlaying, key]);
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { API_BASE, fetchWithSession } from "@/lib/http";
import { BrowserEventOutboxStorage } from "@/lib/browserEventOutbox";
import { createEventOutbox, type EventOutbox } from "@/lib/eventOutbox";
import { readStored, writeStored } from "@/lib/storage";

export type PlaybackEventType =
  | "trackStarted"
  | "trackPlayed"
  | "trackCompleted"
  | "trackSkipped"
  | "trackReplayed"
  | "trackLiked"
  | "trackUnliked"
  | "trackAddedToPlaylist"
  | "trackRemovedFromPlaylist"
  | "trackAddedToQueue"
  | "artistOpened"
  | "albumOpened"
  | "shelfShown";

export interface PlaybackEventInput {
  type: PlaybackEventType;
  trackId?: string;
  entityId?: string;
  positionSeconds?: number;
  listenedSeconds?: number;
  durationSeconds?: number;
  source?: string;
}

interface QueuedEvent extends PlaybackEventInput {
  occurredAt: string;
  sessionId: string;
}

const SESSION_STORAGE_KEY = "caimack.session";
const FLUSH_INTERVAL_MS = 10_000;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listenersAttached = false;
let outbox: EventOutbox<QueuedEvent> | null = null;

let currentDeviceId: string | null = null;
const playbackListeners = new Set<(event: PlaybackEventInput) => void>();

export function subscribePlaybackEvents(listener: (event: PlaybackEventInput) => void): () => void {
  playbackListeners.add(listener);
  return () => {
    playbackListeners.delete(listener);
  };
}

export function deviceId(): string {
  if (typeof window === "undefined") return "";

  currentDeviceId ??= readStored(SESSION_STORAGE_KEY, "session");
  if (!currentDeviceId) {
    currentDeviceId = crypto.randomUUID();
    writeStored(SESSION_STORAGE_KEY, currentDeviceId, "session");
  }

  return currentDeviceId;
}

function attachListeners() {
  if (listenersAttached || typeof document === "undefined") return;
  listenersAttached = true;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushEvents();
  });

  window.addEventListener("pagehide", () => void flushEvents());
  window.addEventListener("online", () => void flushEvents());
  void flushEvents();
}

export function recordEvent(event: PlaybackEventInput): void {
  if (typeof window === "undefined") return;

  attachListeners();

  const eventWithContext: QueuedEvent = {
    ...event,
    occurredAt: new Date().toISOString(),
    sessionId: deviceId(),
  };

  void getOutbox()
    .add(eventWithContext)
    .then(() => {
      for (const listener of playbackListeners) listener(event);
    })
    .catch(() => {});

  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    void flushEvents();
  }, FLUSH_INTERVAL_MS);
}

export async function flushEvents(timeoutMs?: number): Promise<void> {
  if (typeof window === "undefined") return;

  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const flushed = getOutbox()
    .flush()
    .then(() => {})
    .catch(() => {});

  if (timeoutMs === undefined) return flushed;

  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    flushed,
    new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs))),
  ]);
  clearTimeout(timer);
}

function getOutbox(): EventOutbox<QueuedEvent> {
  outbox ??= createEventOutbox({
    storage: new BrowserEventOutboxStorage<QueuedEvent>(),
    isOnline: () => navigator.onLine,
    send: async (events) => {
      try {
        const response = await fetchWithSession(`${API_BASE}/playback/signals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events }),
          keepalive: true,
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  });

  return outbox;
}

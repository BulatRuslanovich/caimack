// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useEffect, useRef } from "react";
import { deviceId } from "@/lib/events";
import { API_BASE, qs, refreshSession } from "@/lib/http";
import { deviceName } from "@/lib/playback/deviceName";

export interface PlaybackTakeover {
  deviceId: string;
  deviceName: string;
}

interface ExclusivePlaybackEvents {
  onClaimed: () => void;
  onDisplaced: (takeover: PlaybackTakeover | null) => void;
}

function parseTakeover(data: unknown): PlaybackTakeover | null {
  if (typeof data !== "string") return null;

  try {
    const parsed = JSON.parse(data) as Partial<PlaybackTakeover>;
    return typeof parsed.deviceId === "string" && typeof parsed.deviceName === "string"
      ? { deviceId: parsed.deviceId, deviceName: parsed.deviceName }
      : null;
  } catch {
    return null;
  }
}

const RECONNECT_DELAYS_MS = [1000, 3000, 8000];

export function useExclusivePlayback(isPlaying: boolean, events: ExclusivePlaybackEvents): void {
  const latest = useRef(events);
  useEffect(() => {
    latest.current = events;
  });

  useEffect(() => {
    if (!isPlaying) return;

    let source: EventSource | null = null;
    let timer: number | null = null;
    let attempt = 0;
    let stopped = false;

    const open = () => {
      if (stopped) return;

      source = new EventSource(
        `${API_BASE}/playback/session${qs({ deviceId: deviceId(), deviceName: deviceName() })}`,
      );

      source.addEventListener("open", () => {
        attempt = 0;
      });

      source.addEventListener("claimed", () => latest.current.onClaimed());

      source.addEventListener("displaced", (event) => {
        stopped = true;
        source?.close();
        latest.current.onDisplaced(parseTakeover(event.data));
      });

      source.addEventListener("error", () => {
        if (source?.readyState !== EventSource.CLOSED) return;

        source.close();
        source = null;

        const delay = RECONNECT_DELAYS_MS[attempt];
        if (delay === undefined) return;
        attempt += 1;

        timer = window.setTimeout(() => {
          timer = null;

          void refreshSession().finally(open);
        }, delay);
      });
    };

    open();

    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      source?.close();
    };
  }, [isPlaying]);
}

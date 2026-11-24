// SPDX-License-Identifier: AGPL-3.0-only

import { recordEvent } from "@/lib/events";
import { playSessionOf, sourceOf } from "@/lib/playback/playSource";
import type { Track } from "@/lib/types";

export interface ListeningTracker {
  begin(track: Track): void;
  accumulate(currentTime: number): void;
  reposition(currentTime: number): void;
  listenedSeconds(): number;
  checkpoint(): void;
  finish(type: "trackCompleted" | "trackSkipped"): void;
  discard(): void;
}

interface Played {
  trackId: string;
  source?: string;
  sessionId?: string;
  seconds: number;
  position: number;
  duration: number;
}

const MAX_LISTENING_STEP_SECONDS = 2;

const HEARTBEAT_INTERVAL_SECONDS = 30;

const IDLE: Played = { trackId: "", seconds: 0, position: 0, duration: 0 };

const HISTORY_THRESHOLD_SECONDS = 30;

export function historyThresholdFor(durationSeconds: number): number {
  return Math.min(HISTORY_THRESHOLD_SECONDS, Math.max(durationSeconds - 1, 1));
}

export function createListeningTracker(record = recordEvent): ListeningTracker {
  let played: Played = { ...IDLE };
  let heartbeatAt = 0;
  const heard = new Set<string>();

  const progressEvent = (type: "trackPlayed" | "trackCompleted" | "trackSkipped") =>
    record({
      type,
      trackId: played.trackId,
      positionSeconds: Math.floor(played.position),
      listenedSeconds: Math.floor(played.seconds),
      durationSeconds: played.duration,
      source: played.source,
      sessionId: played.sessionId,
    });

  return {
    discard() {
      heard.delete(played.trackId);
      played = { ...IDLE };
    },
    listenedSeconds: () => Math.floor(played.seconds),
    checkpoint() {
      if (played.trackId && played.seconds > 0) progressEvent("trackPlayed");
    },
    reposition(currentTime) {
      played.position = currentTime;
    },
    begin(track) {
      const source = sourceOf(track.id);
      const sessionId = playSessionOf(track.id);
      played = {
        trackId: track.id,
        source,
        sessionId,
        seconds: 0,
        position: 0,
        duration: track.durationSeconds,
      };
      heartbeatAt = 0;

      record({
        type: "trackStarted",
        trackId: track.id,
        durationSeconds: track.durationSeconds,
        source,
        sessionId,
      });

      // An automatic radio return is not a deliberate request to replay it.
      if (heard.has(track.id) && !source?.startsWith("radio")) {
        record({
          type: "trackReplayed",
          trackId: track.id,
          durationSeconds: track.durationSeconds,
          source,
        });
      }

      heard.add(track.id);
    },

    accumulate(currentTime) {
      if (!played.trackId) return;

      const delta = currentTime - played.position;
      if (delta > 0 && delta < MAX_LISTENING_STEP_SECONDS) played.seconds += delta;

      played.position = currentTime;

      if (played.seconds - heartbeatAt >= HEARTBEAT_INTERVAL_SECONDS) {
        heartbeatAt = played.seconds;
        progressEvent("trackPlayed");
      }
    },

    finish(type) {
      if (!played.trackId) return;

      progressEvent(type);
      played = { ...IDLE };
    },
  };
}

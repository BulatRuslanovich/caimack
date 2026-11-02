// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

import type { RadioSessionState } from "@/lib/playback/playerTypes";
import type { QueueSignals, RecommendationReason, RecommendedTrack, Track } from "@/lib/types";
import type { PlaybackEventInput } from "@/lib/events";

export function radioReaction(event: PlaybackEventInput): boolean {
  return (
    event.type === "trackCompleted" ||
    event.type === "trackSkipped" ||
    event.type === "trackLiked" ||
    event.type === "trackUnliked" ||
    event.type === "trackReplayed" ||
    event.type === "trackAddedToQueue" ||
    (event.type === "trackPlayed" && (event.listenedSeconds ?? 0) >= 60)
  );
}

export function radioExclusions(queue: Track[], order: number[], currentIndex: number): string[] {
  const position = order.indexOf(currentIndex);
  return order.slice(Math.max(0, position - 2)).map((index) => queue[index].id);
}

// Keep everything already traversed, the next track (possibly in a crossfade),
// and every manual queue entry. Rebuild only the remaining automatic tail.
export function radioRefreshPlan(
  queue: Track[],
  order: number[],
  currentIndex: number,
  generated: (track: Track) => boolean,
): { queue: Track[]; order: number[]; index: number } {
  const position = order.indexOf(currentIndex);
  if (position < 0) return { queue, order, index: currentIndex };
  const protectedIndices = new Set(order.slice(0, position + 2));
  const indices = queue.flatMap((track, index) =>
    protectedIndices.has(index) || !generated(track) ? [index] : [],
  );
  const remap = new Map(indices.map((index, next) => [index, next]));
  return {
    queue: indices.map((index) => queue[index]),
    order: order.filter((index) => remap.has(index)).map((index) => remap.get(index)!),
    index: remap.get(currentIndex)!,
  };
}

export function recommendationReasons(
  items: RecommendedTrack[],
): Record<string, RecommendationReason> {
  return Object.fromEntries(items.map((item) => [item.track.id, item.reason]));
}

export function queueSignals(items: RecommendedTrack[]): Record<string, QueueSignals> {
  return Object.fromEntries(
    items.filter((item) => item.signals).map((item) => [item.track.id, item.signals!]),
  );
}

export function mergeRadioBatch(
  queue: Track[],
  reasons: Record<string, RecommendationReason>,
  signals: Record<string, QueueSignals>,
  items: RecommendedTrack[],
  excluded?: ReadonlySet<string>,
): {
  tracks: Track[];
  reasons: Record<string, RecommendationReason>;
  signals: Record<string, QueueSignals>;
} {
  const known = new Set(excluded ?? queue.map((track) => track.id));
  const fresh = items.filter((item) => {
    if (known.has(item.track.id)) return false;
    known.add(item.track.id);
    return true;
  });

  return {
    tracks: fresh.map((item) => item.track),
    reasons: { ...reasons, ...recommendationReasons(fresh) },
    signals: { ...signals, ...queueSignals(fresh) },
  };
}

export function validRadioSession(value: unknown): value is RadioSessionState {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<RadioSessionState>;
  if (
    candidate.manualTrackIds !== undefined &&
    (!Array.isArray(candidate.manualTrackIds) ||
      !candidate.manualTrackIds.every((id) => typeof id === "string"))
  )
    return false;
  return typeof candidate.reasons === "object" && candidate.reasons !== null;
}

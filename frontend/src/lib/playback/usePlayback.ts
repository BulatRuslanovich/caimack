// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useCallback } from "react";
import type { Track } from "@/lib/types";
import { useNowPlaying, usePlayerActions, usePlayerQueue } from "@/contexts/PlayerContext";
import { matchesCollection } from "./collectionQueue";

export function usePlayback() {
  const { currentTrackId, isPlaying, automaticTrackIds = [] } = useNowPlaying();
  const queue = usePlayerQueue();
  const player = usePlayerActions();

  const setIsOnAir = useCallback(
    (tracks: Track[]) =>
      matchesCollection(
        tracks.map((track) => track.id),
        queue.map((track) => track.id),
        currentTrackId,
        automaticTrackIds,
      ),
    [automaticTrackIds, currentTrackId, queue],
  );

  const playTrack = useCallback(
    (track: Track, context?: Track[]) => {
      if (currentTrackId === track.id) {
        player.toggle();
        return;
      }

      player.playTrack(track, context);
    },
    [currentTrackId, player],
  );

  const playSet = useCallback(
    (tracks: Track[], startIndex = 0) => {
      if (tracks.length === 0) return;

      if (setIsOnAir(tracks)) {
        player.toggle();
        return;
      }

      player.playQueue(tracks, startIndex);
    },
    [setIsOnAir, player],
  );

  const soundingNow = useCallback(
    (trackId: string) => currentTrackId === trackId && isPlaying,
    [currentTrackId, isPlaying],
  );

  return { currentTrackId, isPlaying, playTrack, playSet, soundingNow, setIsOnAir };
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useCallback } from "react";
import type { Track } from "@/lib/types";
import { useNowPlaying, usePlayerActions } from "@/contexts/PlayerContext";

export function usePlayback() {
  const { currentTrackId, isPlaying } = useNowPlaying();
  const player = usePlayerActions();

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

      const inQueue =
        currentTrackId !== null && tracks.some((track) => track.id === currentTrackId);

      if (inQueue) {
        player.toggle();
        return;
      }

      player.playQueue(tracks, startIndex);
    },
    [currentTrackId, player],
  );

  const soundingNow = useCallback(
    (trackId: string) => currentTrackId === trackId && isPlaying,
    [currentTrackId, isPlaying],
  );

  const setIsOnAir = useCallback(
    (tracks: Track[]) =>
      currentTrackId !== null && tracks.some((track) => track.id === currentTrackId),
    [currentTrackId],
  );

  return { currentTrackId, isPlaying, playTrack, playSet, soundingNow, setIsOnAir };
}

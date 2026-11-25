// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useCallback } from "react";
import type { Track } from "@/lib/types";
import { useNowPlaying, usePlayerActions, usePlayerQueue } from "@/contexts/PlayerContext";
import { matchesCollection } from "./collectionQueue";
import { samePlaybackCollection, type PlaybackCollection } from "./playerTypes";

export function usePlayback(collection?: PlaybackCollection) {
  const {
    currentTrackId,
    isPlaying,
    automaticTrackIds = [],
    collection: activeCollection,
  } = useNowPlaying();
  const queue = usePlayerQueue();
  const player = usePlayerActions();

  const setIsOnAir = useCallback(
    (tracks: Track[]) =>
      (!collection || !activeCollection || samePlaybackCollection(collection, activeCollection)) &&
      matchesCollection(
        tracks.map((track) => track.id),
        queue.map((track) => track.id),
        currentTrackId,
        automaticTrackIds,
      ),
    [activeCollection, automaticTrackIds, collection, currentTrackId, queue],
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

      if (collection) player.playQueue(tracks, startIndex, { collection });
      else player.playQueue(tracks, startIndex);
    },
    [collection, setIsOnAir, player],
  );

  const soundingNow = useCallback(
    (trackId: string) => currentTrackId === trackId && isPlaying,
    [currentTrackId, isPlaying],
  );

  return { currentTrackId, isPlaying, playTrack, playSet, soundingNow, setIsOnAir };
}

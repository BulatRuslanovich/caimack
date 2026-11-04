// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useEffect } from "react";
import { mediaUrl } from "@/lib/media";
import { formatArtists } from "@/lib/format";
import type { Track } from "@/lib/types";

interface MediaSessionControls {
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  seekBy: (deltaSeconds: number) => void;
  getPosition: () => number;
}

const DEFAULT_SEEK_OFFSET = 10;

const POSITION_INTERVAL_MS = 1_000;

function artworkFor(track: Track): MediaImage[] | undefined {
  if (!track.hasCover) return undefined;

  return [
    { src: mediaUrl.trackCover(track.id, "thumb"), sizes: "256x256", type: "image/webp" },
    { src: mediaUrl.trackCover(track.id, "full"), sizes: "640x640", type: "image/webp" },
  ];
}

export function useMediaSession(
  track: Track | null,
  isPlaying: boolean,
  duration: number,
  controls: MediaSessionControls,
) {
  const { play, pause, next, previous, seek, seekBy, getPosition } = controls;

  useEffect(() => {
    if (!("mediaSession" in navigator) || !track) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: formatArtists(track),
      album: track.albumTitle ?? undefined,
      artwork: artworkFor(track),
    });
  }, [track]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.playbackState = !track ? "none" : isPlaying ? "playing" : "paused";
  }, [track, isPlaying]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !track) return;

    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", play],
      ["pause", pause],
      ["stop", pause],
      ["previoustrack", previous],
      ["nexttrack", next],
      ["seekto", (details) => details.seekTime !== undefined && seek(details.seekTime)],
      ["seekbackward", (details) => seekBy(-(details.seekOffset ?? DEFAULT_SEEK_OFFSET))],
      ["seekforward", (details) => seekBy(details.seekOffset ?? DEFAULT_SEEK_OFFSET)],
    ];

    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {}
    }

    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {}
      }
    };
  }, [track, play, pause, next, previous, seek, seekBy]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;

    if (!track || duration <= 0 || !Number.isFinite(duration)) {
      try {
        navigator.mediaSession.setPositionState();
      } catch {}
      return;
    }

    const publish = () => {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          position: Math.max(0, Math.min(getPosition(), duration)),
          playbackRate: 1,
        });
      } catch {}
    };

    publish();

    const timer = window.setInterval(publish, POSITION_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [track, duration, getPosition]);
}

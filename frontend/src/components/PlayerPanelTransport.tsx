// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useT } from "@/contexts/I18nContext";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { formatArtists } from "@/lib/format";
import { SkipForwardIcon } from "lucide-react";
import { TrackCover } from "./Cover";
import { PlayPauseButton } from "./PlayPauseButton";
import { Button } from "./ui/button";

/** Stays outside the scrolling queue/lyrics pane on small screens. */
export function PlayerPanelTransport({ onShowArtwork }: { onShowArtwork: () => void }) {
  const t = useT();
  const { currentTrack: track, isPlaying, buffering } = usePlayerState();
  const { toggle, next } = usePlayerActions();
  if (!track) return null;

  return (
    <div
      role="group"
      aria-label={t("player.nowPlaying")}
      className="flex min-h-16 items-center gap-2"
    >
      <button
        type="button"
        onClick={onShowArtwork}
        aria-label={t("player.showArtwork", { title: track.title })}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-sm py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <TrackCover track={track} size={40} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-2 text-sm leading-5 font-semibold wrap-anywhere">
            {track.title}
          </span>
          <span className="truncate text-xs leading-4 text-muted-foreground">
            {formatArtists(track)}
          </span>
        </span>
      </button>
      <PlayPauseButton playing={isPlaying} buffering={buffering} onToggle={toggle} />
      <Button variant="ghost" size="icon-lg" onClick={next} aria-label={t("player.nextTrack")}>
        <SkipForwardIcon size={24} />
      </Button>
    </div>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useT } from "@/contexts/I18nContext";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { usePlayerUi } from "@/contexts/PlayerUiContext";
import { cn } from "@/lib/cn";
import { trackCoverUrl } from "@/lib/media";
import { usePlaybackProgress } from "@/lib/playback/usePlaybackProgress";
import { usePlayerShortcuts } from "@/lib/playback/usePlayerShortcuts";
import { reasonLabel } from "@/lib/recommendationReason";
import { useToggleFavorite } from "@/lib/useToggleFavorite";
import { HeartIcon, ListVideoIcon, SkipForwardIcon } from "lucide-react";
import Link from "next/link";
import { ArtistLinks } from "./ArtistLinks";
import { DeferredFullPlayer } from "./FullPlayerLoader";
import { PlaybackDevices, PlaybackDeviceStatus } from "./PlaybackDevices";
import { PlayPauseButton } from "./PlayPauseButton";
import { PlayerBar } from "./PlayerBar";
import { PlayerOptionsMenu } from "./PlayerOptionsMenu";
import { PlayerProgress, PlayerProgressLine } from "./PlayerProgress";
import { PlayerTransport } from "./PlayerTransport";
import { PlayerVolume } from "./PlayerVolume";
import { Record } from "./Record";
import { Button } from "./ui/button";

function Progress({ fallbackDuration, line }: { fallbackDuration: number; line?: boolean }) {
  const progress = usePlaybackProgress(fallbackDuration);
  return line ? (
    <PlayerProgressLine position={progress.position} total={progress.total} />
  ) : (
    <PlayerProgress
      position={progress.position}
      total={progress.total}
      bufferedPercent={progress.bufferedPercent}
      seek={progress.seek}
    />
  );
}

export function Player() {
  const state = usePlayerState();
  const actions = usePlayerActions();
  const t = useT();
  const { queueOpen, setQueueOpen } = usePlayerUi();
  const { currentTrack } = state;
  const toggleFavorite = useToggleFavorite();

  usePlayerShortcuts(() => setQueueOpen((open) => !open));

  if (!currentTrack) return null;

  const likeCurrent = () => void toggleFavorite(currentTrack);
  const reason = state.radioSession?.reasons[currentTrack.id];
  const favoriteLabel = currentTrack.isFavorite
    ? t("tracks.removeFromFavorites")
    : t("tracks.addToFavorites");

  const favoriteButton = (className: string) => (
    <Button
      variant="ghost"
      size="icon"
      className={cn(className, currentTrack.isFavorite && "text-primary hover:text-primary")}
      onClick={likeCurrent}
      aria-label={favoriteLabel}
      aria-pressed={currentTrack.isFavorite}
    >
      <HeartIcon className={currentTrack.isFavorite ? "fill-current" : undefined} />
    </Button>
  );

  return (
    <PlayerBar
      artworkUrl={trackCoverUrl(currentTrack, "thumb")}
      artwork={(expanded) => (
        <Record
          track={currentTrack}
          out={state.isPlaying}
          spinning={state.isPlaying && !state.buffering}
          transitionCover={!expanded}
          className="w-(--player-cover) [--record-out:20%]"
        />
      )}
      metadata={
        <>
          {currentTrack.albumId ? (
            <Link
              href={`/albums/${currentTrack.albumId}`}
              className="truncate text-sm font-medium hover:underline"
              title={currentTrack.title}
            >
              {currentTrack.title}
            </Link>
          ) : (
            <span className="truncate text-sm font-medium" title={currentTrack.title}>
              {currentTrack.title}
            </span>
          )}
          <ArtistLinks track={currentTrack} className="truncate text-sm text-muted-foreground" />
          <PlaybackDeviceStatus />
          {reason && (
            <span className="truncate text-2xs text-faint max-md:hidden">
              {reasonLabel(reason, t)}
            </span>
          )}
        </>
      }
      mobileControls={
        <>
          {favoriteButton("relative shrink-0 md:hidden")}
          <div className="relative flex items-center gap-0.5 md:hidden">
            <PlayPauseButton
              playing={state.isPlaying}
              buffering={state.buffering}
              onToggle={actions.toggle}
              size="compact"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={actions.next}
              aria-label={t("player.nextTrack")}
            >
              <SkipForwardIcon size={24} />
            </Button>
          </div>
        </>
      }
      transport={<PlayerTransport />}
      progress={<Progress fallbackDuration={currentTrack.durationSeconds} />}
      progressLine={<Progress fallbackDuration={currentTrack.durationSeconds} line />}
      actions={
        <>
          <div className="flex shrink-0 items-center gap-0.5">
            <PlaybackDevices compact />
            <PlayerOptionsMenu track={currentTrack} />
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {favoriteButton("max-lg:hidden")}
            <Button
              variant="ghost"
              size="icon"
              className={cn(queueOpen && "text-primary")}
              onClick={() => setQueueOpen((open) => !open)}
              aria-label={t("queue.label")}
              aria-pressed={queueOpen}
              title={
                state.nextTrack
                  ? t("player.upNextNamed", { title: state.nextTrack.title })
                  : t("queue.title")
              }
            >
              <ListVideoIcon />
            </Button>
            <div className="flex items-center gap-1">
              <PlayerVolume seekbarClassName="w-20 max-w-20 max-lg:w-12 max-lg:max-w-12" />
            </div>
          </div>
        </>
      }
      expandedPlayer={(onClose) => (
        <DeferredFullPlayer onClose={onClose} onToggleFavorite={likeCurrent} />
      )}
      next={actions.next}
      previous={actions.previous}
    />
  );
}

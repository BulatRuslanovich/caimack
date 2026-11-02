// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { reasonLabel } from "@/lib/recommendationReason";
import { SEEK_STEP } from "@/lib/shortcuts";
import { usePlaybackProgress } from "@/lib/playback/usePlaybackProgress";
import { useToggleFavorite } from "@/lib/useToggleFavorite";
import { usePlayerShortcuts } from "@/lib/playback/usePlayerShortcuts";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { usePlayerUi } from "@/contexts/PlayerUiContext";
import { useT } from "@/contexts/I18nContext";
import { ArtistLinks } from "./ArtistLinks";
import { Record } from "./Record";
import { Seekbar } from "./Seekbar";
import { PlayerTransport } from "./PlayerTransport";
import { PlayerVolume } from "./PlayerVolume";
import { StreamQuality } from "./StreamQuality";
import { FullScreenPlayer } from "./FullScreenPlayer";
import { BufferingRing } from "./PlaybackIndicators";
import { SleepTimerButton } from "./SleepTimerButton";
import { Button } from "./ui/button";
import {
  HeartIcon,
  ListVideoIcon,
  Maximize2Icon,
  PauseIcon,
  PlayIcon,
  SkipForwardIcon,
} from "lucide-react";

const SWIPE_OPEN_PX = 40;

const SWIPE_SKIP_PX = 80;

const shellClass =
  "player-shell relative min-h-(--player-height) border-t border-border px-5 py-3 [grid-area:player] max-md:border-t-0 max-md:px-2.5 max-md:py-2";

function ProgressRow({
  fallbackDuration,
  tooltip = false,
  className,
}: {
  fallbackDuration: number;
  tooltip?: boolean;
  className?: string;
}) {
  const progress = usePlaybackProgress(fallbackDuration);

  const clock = "w-10 shrink-0 text-2xs text-faint tabular-nums";

  return (
    <div className={cn("flex w-full items-center gap-2", className)}>
      <span className={cn(clock, "text-right")}>{formatDuration(progress.position)}</span>

      <Seekbar
        className="min-w-0 flex-1"
        variant="player"
        value={progress.position}
        max={progress.total}
        onSeek={progress.seek}
        ariaLabel={progress.seekLabel}
        valueText={progress.valueText}
        keyStep={SEEK_STEP}
        style={{ ["--buffered" as string]: `${progress.bufferedPercent}%` }}
        tooltip={tooltip ? formatDuration : undefined}
        commitOnRelease
      />

      <button
        type="button"
        onClick={progress.toggleRemainingTime}
        aria-label={progress.toggleRemainingLabel}
        title={progress.toggleRemainingLabel}
        className={cn(clock, "rounded-sm text-left hover:text-foreground")}
      >
        {progress.endLabel}
      </button>
    </div>
  );
}

function ProgressLine({ fallbackDuration }: { fallbackDuration: number }) {
  const { position, total } = usePlaybackProgress(fallbackDuration);

  return (
    <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-border md:hidden">
      <span
        className="block h-full bg-foreground"
        style={{ width: `${total > 0 ? Math.min(100, (position / total) * 100) : 0}%` }}
      />
    </span>
  );
}

export function Player() {
  const state = usePlayerState();
  const actions = usePlayerActions();
  const t = useT();

  const [expanded, setExpandedNow] = useState(false);
  const { queueOpen, setQueueOpen } = usePlayerUi();
  const transition = useRef<ViewTransition | null>(null);
  const swipeFrom = useRef<{ x: number; y: number } | null>(null);
  const [swipeX, setSwipeX] = useState(0);
  const { currentTrack } = state;

  usePlayerShortcuts(() => setQueueOpen((open) => !open));

  useEffect(
    () => () => {
      transition.current?.skipTransition();
      delete document.documentElement.dataset.playerTransition;
    },
    [],
  );

  const setExpanded = (next: boolean) => {
    transition.current?.skipTransition();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduceMotion) {
      delete document.documentElement.dataset.playerTransition;
      setExpandedNow(next);
      return;
    }

    document.documentElement.dataset.playerTransition = "true";
    const running = document.startViewTransition(() => flushSync(() => setExpandedNow(next)));
    transition.current = running;
    void running.ready.catch(() => undefined);
    const finish = () => {
      if (transition.current !== running) return;
      transition.current = null;
      delete document.documentElement.dataset.playerTransition;
    };
    void running.finished.then(finish, finish);
  };

  const toggleFavorite = useToggleFavorite();
  const likeCurrent = () => {
    if (currentTrack) void toggleFavorite(currentTrack);
  };

  if (!currentTrack) return null;

  const reason = state.radioSession?.reasons[currentTrack.id];

  const favoriteLabel = currentTrack.isFavorite
    ? t("tracks.removeFromFavorites")
    : t("tracks.addToFavorites");

  return (
    <>
      <footer
        className={shellClass}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          const onSlider = (event.target as Element).closest("input");
          swipeFrom.current = onSlider ? null : { x: touch.clientX, y: touch.clientY };
        }}
        onTouchMove={(event) => {
          const from = swipeFrom.current;
          if (!from) return;

          const touch = event.touches[0];
          const dx = touch.clientX - from.x;
          if (Math.abs(dx) > Math.abs(touch.clientY - from.y)) setSwipeX(dx);
        }}
        onTouchEnd={(event) => {
          const from = swipeFrom.current;
          swipeFrom.current = null;
          setSwipeX(0);
          if (!from) return;

          const touch = event.changedTouches[0];
          const dx = touch.clientX - from.x;
          const dy = from.y - touch.clientY;
          if (Math.abs(dx) > Math.abs(dy)) {
            if (dx <= -SWIPE_SKIP_PX) actions.next();
            else if (dx >= SWIPE_SKIP_PX) actions.previous();
          } else if (dy > SWIPE_OPEN_PX) setExpanded(true);
        }}
        onTouchCancel={() => {
          swipeFrom.current = null;
          setSwipeX(0);
        }}
      >
        <div className="grid h-full grid-cols-[minmax(0,1fr)_clamp(15rem,32vw,28rem)_minmax(0,1fr)] items-center gap-5 max-lg:gap-3 max-md:h-auto max-md:grid-cols-1 max-md:gap-0">
          <div
            className={cn(
              "relative flex min-w-0 items-center gap-3 max-md:gap-2.5",
              swipeX === 0 && "transition-[translate,opacity] duration-200 ease-brand",
            )}
            style={{
              translate: `${swipeX}px 0`,
              opacity: 1 - Math.min(Math.abs(swipeX) / (SWIPE_SKIP_PX * 3), 0.5),
            }}
          >
            <span
              aria-hidden="true"
              onClick={() => setExpanded(true)}
              className="absolute inset-0 cursor-pointer md:hidden"
            />

            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-label={t("player.openFull")}
              className="mr-2.5 shrink-0 leading-none"
            >
              <Record
                track={currentTrack}
                out={state.isPlaying}
                spinning={state.isPlaying && !state.buffering}
                transitionCover={!expanded}
                className="w-(--player-cover) [--record-out:20%]"
              />
            </button>

            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
              <ArtistLinks
                track={currentTrack}
                className="truncate text-sm text-muted-foreground"
              />
              {reason && (
                <span className="truncate text-2xs text-faint max-md:hidden">
                  {reasonLabel(reason, t)}
                </span>
              )}
            </div>

            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "relative shrink-0 md:hidden",
                currentTrack.isFavorite && "text-primary",
              )}
              onClick={likeCurrent}
              aria-label={favoriteLabel}
              aria-pressed={currentTrack.isFavorite}
            >
              <HeartIcon className={currentTrack.isFavorite ? "fill-current" : undefined} />
            </Button>

            <div className="relative flex items-center gap-0.5 md:hidden">
              <Button
                variant="ghost"
                size="icon"
                className="relative"
                onClick={actions.toggle}
                aria-label={state.isPlaying ? t("action.pause") : t("action.play")}
                aria-busy={state.buffering}
              >
                {state.isPlaying ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
                {state.buffering && <BufferingRing />}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={actions.next}
                aria-label={t("player.nextTrack")}
              >
                <SkipForwardIcon size={24} />
              </Button>
            </div>
          </div>

          <div className="flex min-w-0 flex-col items-center gap-1.5 max-md:hidden">
            <PlayerTransport />
            <ProgressRow tooltip fallbackDuration={currentTrack.durationSeconds} />
          </div>

          <div className="flex min-w-0 items-center justify-end gap-3 max-lg:gap-1 max-md:hidden">
            <div className="flex shrink-0 items-center gap-0.5">
              <StreamQuality
                track={currentTrack}
                className="border-transparent font-medium text-faint max-xl:hidden"
              />
              <SleepTimerButton className={state.sleepTimer ? "text-primary" : "text-faint"} />
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className={cn(currentTrack.isFavorite && "text-primary")}
                onClick={likeCurrent}
                aria-label={favoriteLabel}
                aria-pressed={currentTrack.isFavorite}
              >
                <HeartIcon className={currentTrack.isFavorite ? "fill-current" : undefined} />
              </Button>

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

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setExpanded(true)}
                aria-label={t("player.openFull")}
                title={t("player.openFull")}
              >
                <Maximize2Icon size={18} />
              </Button>
            </div>
          </div>
        </div>

        <ProgressLine fallbackDuration={currentTrack.durationSeconds} />
      </footer>

      {expanded && (
        <FullScreenPlayer onClose={() => setExpanded(false)} onToggleFavorite={likeCurrent} />
      )}
    </>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { cn } from "@/lib/cn";
import type { TranslationKey } from "@/lib/i18n";
import { usePlayerActions, usePlayerState, type RepeatMode } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { PlayPauseButton } from "./PlayPauseButton";
import { Button } from "./ui/button";
import { Repeat1Icon, RepeatIcon, ShuffleIcon, SkipBackIcon, SkipForwardIcon } from "lucide-react";
import type { ReactNode } from "react";

const REPEAT_MODES: Record<RepeatMode, TranslationKey> = {
  off: "player.repeatOff",
  one: "player.repeatOne",
  all: "player.repeatAll",
};

interface NavigationControl {
  label: string;
  run: () => void;
  disabled?: boolean;
}

export function TransportButtons({
  size,
  playing,
  buffering,
  toggle,
  previous,
  next,
  before,
  after,
}: {
  size: "bar" | "full";
  playing: boolean;
  buffering: boolean;
  toggle: () => void;
  previous: NavigationControl;
  next: NavigationControl;
  before: ReactNode;
  after: ReactNode;
}) {
  const large = size === "full";
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") event.stopPropagation();
      }}
      className={cn(
        "player-transport flex items-center",
        large ? "justify-center gap-4 max-[420px]:gap-1.5" : "gap-1.5",
      )}
    >
      {before}
      <Button
        variant="ghost"
        size={large ? "icon-lg" : "icon"}
        className={large ? undefined : "size-10"}
        onClick={previous.run}
        disabled={previous.disabled}
        aria-label={previous.label}
        title={previous.label}
      >
        <SkipBackIcon size={large ? 34 : 28} />
      </Button>
      <PlayPauseButton playing={playing} buffering={buffering} onToggle={toggle} size={size} />
      <Button
        variant="ghost"
        size={large ? "icon-lg" : "icon"}
        className={large ? undefined : "size-10"}
        onClick={next.run}
        disabled={next.disabled}
        aria-label={next.label}
        title={next.label}
      >
        <SkipForwardIcon size={large ? 34 : 28} />
      </Button>
      {after}
    </div>
  );
}

export function PlayerTransport({ size = "bar" }: { size?: "bar" | "full" }) {
  const { isPlaying, buffering, shuffle, repeat } = usePlayerState();
  const { toggle, next, previous, toggleShuffle, cycleRepeat } = usePlayerActions();
  const t = useT();

  const large = size === "full";
  const repeatLabel = t("player.repeat", { mode: t(REPEAT_MODES[repeat]) });

  return (
    <TransportButtons
      size={size}
      playing={isPlaying}
      buffering={buffering}
      toggle={toggle}
      previous={{ label: t("player.previousTrack"), run: previous }}
      next={{ label: t("player.nextTrack"), run: next }}
      before={
        <Button
          variant="ghost"
          size={large ? "icon-lg" : "icon"}
          className="player-mode"
          onClick={toggleShuffle}
          aria-label={t("player.shuffle")}
          aria-pressed={shuffle}
          title={t("player.shuffle")}
        >
          <ShuffleIcon size={large ? 24 : 20} />
        </Button>
      }
      after={
        <Button
          variant="ghost"
          size={large ? "icon-lg" : "icon"}
          className="player-mode"
          onClick={cycleRepeat}
          aria-label={repeatLabel}
          aria-pressed={repeat !== "off"}
          title={repeatLabel}
        >
          {repeat === "one" ? (
            <Repeat1Icon size={large ? 24 : 20} />
          ) : (
            <RepeatIcon size={large ? 24 : 20} />
          )}
        </Button>
      }
    />
  );
}

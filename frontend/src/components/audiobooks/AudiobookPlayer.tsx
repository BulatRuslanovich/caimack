// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import {
  AudioLinesIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Player } from "@/components/Player";
import { PrefetchLink } from "@/components/PrefetchLink";
import { Button } from "@/components/ui/button";
import { useAudiobookClock, useAudiobooks } from "@/contexts/AudiobookContext";
import { useT } from "@/contexts/I18nContext";
import { formatDuration } from "@/lib/format";
import { isTypingTarget, resolveShortcut } from "@/lib/shortcuts";
import { AudiobookCover, useAudiobookArtwork } from "./AudiobookViews";
import { audiobookHref, type Audiobook } from "@/lib/audiobooks";

const SKIP_MS = 15_000;
const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export function PlaybackFooter() {
  const { player } = useAudiobooks();
  return player.active ? <AudiobookPlayer book={player.active.book} /> : <Player />;
}

function AudiobookPlayer({ book }: { book: Audiobook }) {
  const t = useT();
  const { player } = useAudiobooks();
  const artwork = useAudiobookArtwork(book);
  const last = useRef(player);
  const currentChapter = book.chapters[player.active?.chapterIndex ?? 0];
  const { playing, speed } = player;
  const { durationMs, positionMs } = useAudiobookClock();

  useEffect(() => {
    last.current = player;
  }, [player]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (isTypingTarget(target) || target?.closest("button, select, a, [role='menuitem']")) return;
      if (document.querySelector("[data-state='open']:is([role='dialog'], [role='menu'])")) return;

      const shortcut = resolveShortcut(event);
      if (shortcut?.action === "playPause" && !event.repeat) {
        event.preventDefault();
        last.current.toggle();
      }
      if (shortcut?.action === "seekBy" && shortcut.value) {
        event.preventDefault();
        last.current.skip(Math.sign(shortcut.value) * SKIP_MS);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentChapter.title,
      artist: book.author ?? "",
      album: book.title,
      artwork: artwork ? [{ src: artwork }] : [],
    });
  }, [book.author, book.title, currentChapter.title, artwork]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => !last.current.playing && last.current.toggle()],
      ["pause", () => last.current.playing && last.current.toggle()],
      ["stop", () => last.current.close()],
      ["seekto", ({ seekTime }) => seekTime !== undefined && last.current.seek(seekTime * 1000)],
      ["seekbackward", ({ seekOffset = 15 }) => last.current.skip(-seekOffset * 1000)],
      ["seekforward", ({ seekOffset = 15 }) => last.current.skip(seekOffset * 1000)],
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
  }, []);

  useEffect(() => {
    if (
      !navigator.mediaSession?.setPositionState ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0
    )
      return;
    navigator.mediaSession.setPositionState({
      duration: durationMs / 1000,
      position: Math.min(positionMs, durationMs) / 1000,
      playbackRate: speed,
    });
  }, [durationMs, positionMs, speed]);

  return (
    <footer
      aria-label={t("audiobooks.player")}
      className="grid grid-cols-[minmax(10rem,1fr)_auto_minmax(8rem,2fr)_auto] items-center gap-4 border-t border-border bg-card px-5 py-2.5 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-2 max-md:px-3"
    >
      <PrefetchLink
        href={audiobookHref(book.id)}
        aria-label={t("audiobooks.chapters")}
        className="flex min-w-0 items-center gap-2.5 rounded-md text-left"
      >
        <AudiobookCover book={book} artwork={artwork} className="size-10 rounded-sm" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{book.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {currentChapter.title}
          </span>
        </span>
      </PrefetchLink>
      <div className="flex items-center justify-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => player.skip(-SKIP_MS)}
          aria-label={t("audiobooks.back15")}
          title={t("audiobooks.back15")}
        >
          <RotateCcwIcon size={18} />
        </Button>
        <Button
          variant="play"
          size="icon"
          onClick={player.toggle}
          disabled={player.pending}
          aria-label={t(playing ? "action.pause" : "action.play")}
        >
          {playing ? <PauseIcon size={19} /> : <PlayIcon size={19} />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => player.skip(SKIP_MS)}
          aria-label={t("audiobooks.forward15")}
          title={t("audiobooks.forward15")}
        >
          <RotateCwIcon size={18} />
        </Button>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
        <span>{formatDuration(positionMs / 1000)}</span>
        <input
          type="range"
          min={0}
          max={Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 1}
          step={100}
          disabled={!durationMs}
          value={positionMs}
          aria-label={t("audiobooks.position")}
          aria-valuetext={formatDuration(positionMs / 1000)}
          onChange={(event) => player.seek(Number(event.target.value))}
          className="min-w-0 flex-1 accent-primary"
        />
        <span>{formatDuration(durationMs / 1000)}</span>
      </div>
      <div className="flex items-center justify-end gap-1">
        <label className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-raised">
          <AudioLinesIcon size={14} aria-hidden="true" className="max-md:hidden" />
          <select
            aria-label={t("audiobooks.speed")}
            value={speed}
            onChange={(event) => player.setSpeed(Number(event.target.value))}
            className="bg-card text-foreground"
          >
            {SPEEDS.map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={player.close}
          aria-label={t("audiobooks.closePlayer")}
        >
          <XIcon size={16} />
        </Button>
      </div>
    </footer>
  );
}

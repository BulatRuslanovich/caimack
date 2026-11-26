// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { SkipForwardIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { DeferredAudiobookFullPlayer } from "@/components/FullPlayerLoader";
import { Player } from "@/components/Player";
import { PlayerBar } from "@/components/PlayerBar";
import { PlayPauseButton } from "@/components/PlayPauseButton";
import { PrefetchLink } from "@/components/PrefetchLink";
import { VolumeControls } from "@/components/PlayerVolume";
import { Button } from "@/components/ui/button";
import { useAudiobookClock, useAudiobooks } from "@/contexts/AudiobookContext";
import { PlaybackDevices } from "../PlaybackDevices";
import { useT } from "@/contexts/I18nContext";
import { isTypingTarget, resolveShortcut } from "@/lib/shortcuts";
import { AudiobookCover, useAudiobookArtwork } from "./AudiobookViews";
import { audiobookHref, type Audiobook } from "@/lib/audiobooks";
import {
  AudiobookProgress,
  AudiobookSaveButton,
  AudiobookSpeed,
  AudiobookTransport,
  BOOK_SKIP_MS,
} from "./AudiobookControls";

export function PlaybackFooter() {
  const { player } = useAudiobooks();
  return player.active ? <AudiobookPlayer book={player.active.book} /> : <Player />;
}

function AudiobookPlayer({ book }: { book: Audiobook }) {
  const t = useT();
  const { player } = useAudiobooks();
  const artwork = useAudiobookArtwork(book);
  const active = player.active;
  if (!active) return null;
  const currentChapter = book.chapters[active.chapterIndex];

  return (
    <>
      <AudiobookPlatform book={book} chapter={currentChapter.title} artwork={artwork} />
      <PlayerBar
        label={t("audiobooks.player")}
        artworkUrl={artwork}
        artwork={(expanded) => (
          <AudiobookCover
            book={book}
            artwork={artwork}
            className="w-(--player-cover) rounded-xs"
            style={{ viewTransitionName: expanded ? undefined : "player-artwork" }}
          />
        )}
        metadata={
          <>
            <PrefetchLink
              href={audiobookHref(book.id)}
              className="truncate text-sm font-medium hover:underline"
              title={book.title}
            >
              {book.title}
            </PrefetchLink>
            <span className="truncate text-sm text-muted-foreground">{currentChapter.title}</span>
          </>
        }
        mobileControls={
          <>
            <PlaybackDevices
              compact
              transferBook={player.transferTo}
              className="relative md:hidden"
            />
            <AudiobookSaveButton book={book} className="relative shrink-0 md:hidden" />
            <div className="relative flex items-center gap-0.5 md:hidden">
              <PlayPauseButton
                playing={player.playing}
                buffering={player.pending}
                onToggle={() => !player.pending && player.toggle()}
                size="compact"
              />
              <Button
                variant="ghost"
                size="icon"
                disabled={active.chapterIndex + 1 >= book.chapters.length}
                onClick={() => player.changeChapter(1)}
                aria-label={t("audiobooks.nextChapter")}
              >
                <SkipForwardIcon size={24} />
              </Button>
            </div>
          </>
        }
        transport={<AudiobookTransport />}
        progress={<AudiobookProgress />}
        progressLine={<AudiobookProgress line />}
        actions={
          <div className="flex shrink-0 items-center gap-0.5">
            <PlaybackDevices compact transferBook={player.transferTo} />
            <AudiobookSpeed />
            <AudiobookSaveButton book={book} className="max-lg:hidden" />
            <div className="flex items-center gap-1">
              <VolumeControls
                {...player}
                seekbarClassName="w-20 max-w-20 max-lg:w-12 max-lg:max-w-12"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={player.close}
              aria-label={t("audiobooks.closePlayer")}
              title={t("audiobooks.closePlayer")}
            >
              <XIcon size={18} />
            </Button>
          </div>
        }
        expandedPlayer={(onClose, restoreFocus) => (
          <DeferredAudiobookFullPlayer
            artwork={artwork}
            onClose={onClose}
            restoreFocus={restoreFocus}
          />
        )}
        next={() => player.changeChapter(1)}
        previous={() => player.changeChapter(-1)}
      />
    </>
  );
}

function AudiobookPlatform({
  book,
  chapter,
  artwork,
}: {
  book: Audiobook;
  chapter: string;
  artwork: string | null;
}) {
  const { player } = useAudiobooks();
  const last = useRef(player);
  const { playing, speed } = player;
  const { durationMs, positionMs } = useAudiobookClock();

  useEffect(() => {
    last.current = player;
  }, [player]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (isTypingTarget(target) || target?.closest("button, select, a, [role='menuitem']")) return;
      if (document.querySelector("[data-state='open'][role='menu']")) return;
      const dialog = document.querySelector("[data-state='open'][role='dialog']");
      if (dialog && !dialog.matches("[data-player-fullscreen]")) return;

      const shortcut = resolveShortcut(event);
      if (shortcut?.action === "playPause" && !event.repeat) {
        event.preventDefault();
        last.current.toggle();
      }
      if (shortcut?.action === "seekBy" && shortcut.value) {
        event.preventDefault();
        last.current.skip(Math.sign(shortcut.value) * BOOK_SKIP_MS);
      }
      if ((shortcut?.action === "previous" || shortcut?.action === "next") && !event.repeat) {
        event.preventDefault();
        last.current.changeChapter(shortcut.action === "previous" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: chapter,
      artist: book.author ?? "",
      album: book.title,
      artwork: artwork ? [{ src: artwork }] : [],
    });
  }, [book.author, book.title, chapter, artwork]);

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
      ["previoustrack", () => last.current.changeChapter(-1)],
      ["nexttrack", () => last.current.changeChapter(1)],
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

  return null;
}

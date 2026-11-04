// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { formatArtists } from "@/lib/format";
import { LEAN_BACK_IDLE_MS, leanBack, useLeanBack } from "@/lib/leanBack";
import { activeLineAt } from "@/lib/lyrics";
import { trackCoverUrl } from "@/lib/media";
import { queries } from "@/lib/queries";
import { useIdle } from "@/lib/useIdle";
import type { Track } from "@/lib/types";
import { usePlayerProgress, usePlayerState } from "@/contexts/PlayerContext";
import { useI18n } from "@/contexts/I18nContext";
import { ArtBackdrop } from "./ArtBackdrop";
import { Record } from "./Record";

const WAKE_DISTANCE_PX = 12;

export function LeanBack() {
  const { currentTrack, isPlaying } = usePlayerState();
  const { open, auto } = useLeanBack();

  const idle = useIdle(LEAN_BACK_IDLE_MS, auto && isPlaying && !open && currentTrack !== null);

  useEffect(() => {
    if (idle && document.visibilityState === "visible") leanBack.show();
  }, [idle]);

  if (!open || !currentTrack) return null;

  return <LeanBackScreen track={currentTrack} />;
}

function LeanBackScreen({ track }: { track: Track }) {
  const { isPlaying, buffering } = usePlayerState();
  const { locale } = useI18n();
  const clock = useClock(locale);

  useEffect(() => {
    let origin: { x: number; y: number } | null = null;

    const wake = () => leanBack.hide();

    const press = (event: PointerEvent) => {
      event.preventDefault();
      const swallow = (click: MouseEvent) => {
        click.preventDefault();
        click.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 500);
      wake();
    };

    const moved = (event: PointerEvent) => {
      origin ??= { x: event.clientX, y: event.clientY };
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > WAKE_DISTANCE_PX) wake();
    };

    window.addEventListener("pointermove", moved, { passive: true });
    window.addEventListener("pointerdown", press, { capture: true });
    window.addEventListener("keydown", wake);
    window.addEventListener("wheel", wake, { passive: true });

    let lock: Promise<WakeLockSentinel | undefined> | undefined;
    const acquire = () => {
      if (document.visibilityState === "visible")
        lock = navigator.wakeLock?.request("screen").catch(() => undefined);
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);

    return () => {
      window.removeEventListener("pointermove", moved);
      window.removeEventListener("pointerdown", press, { capture: true });
      window.removeEventListener("keydown", wake);
      window.removeEventListener("wheel", wake);
      document.removeEventListener("visibilitychange", acquire);
      void lock?.then((sentinel) => sentinel?.release());
    };
  }, []);

  return (
    <div className="lean-back" data-aura-host role="presentation">
      <ArtBackdrop mode="stage" src={trackCoverUrl(track, "thumb")} />

      <div className="lean-back-stage">
        <div className="lean-back-clock">
          <span className="font-display tabular-nums">{clock.time}</span>
          <span className="text-muted-foreground">{clock.date}</span>
        </div>

        <Record
          key={track.id}
          track={track}
          out
          spinning={isPlaying && !buffering}
          aura
          sizes="min(56vh, 40vw)"
          className="lean-back-record"
        />

        <div className="lean-back-meta">
          <h2 className={cn("font-display text-balance", "lean-back-title")}>{track.title}</h2>
          <p className="text-xl text-muted-foreground">
            {[formatArtists(track), track.albumTitle].filter(Boolean).join(" — ")}
          </p>
          {track.hasLyrics && <LyricLine trackId={track.id} />}
        </div>
      </div>

      <LeanBackProgress fallback={track.durationSeconds} />
    </div>
  );
}

function LyricLine({ trackId }: { trackId: string }) {
  const { position } = usePlayerProgress();
  const { data: lyrics } = useQuery(queries.lyrics(trackId));

  const lines = lyrics?.lines ?? [];
  const index = activeLineAt(lines, position * 1000);
  const text = index >= 0 ? lines[index].text.trim() : "";

  if (!text) return null;

  return (
    <p key={index} className="lean-back-lyric font-display text-balance">
      {text}
    </p>
  );
}

function LeanBackProgress({ fallback }: { fallback: number }) {
  const { position, duration } = usePlayerProgress();
  const total = duration > 0 ? duration : fallback;

  return (
    <div className="lean-back-progress" aria-hidden="true">
      <span style={{ width: `${total > 0 ? Math.min(100, (position / total) * 100) : 0}%` }} />
    </div>
  );
}

function useClock(locale: string) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const ticking = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(ticking);
  }, []);

  return {
    time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(now),
    date: new Intl.DateTimeFormat(locale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(now),
  };
}

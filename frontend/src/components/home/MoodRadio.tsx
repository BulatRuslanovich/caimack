// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { coverUrl } from "@/lib/media";
import { moodLabel } from "@/lib/moods";
import { queries } from "@/lib/queries";
import type { Mood } from "@/lib/types";
import { toneStyle, useVividTone } from "@/lib/useCoverTone";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { AlbumCover } from "@/components/Cover";
import { MoodIcon } from "@/components/MoodIcon";
import { Section } from "@/components/PageHeader";
import { NowPlayingBars } from "@/components/PlaybackIndicators";
import { hiddenScrollbar } from "@/components/Shelf";

export function MoodRadio() {
  const t = useT();
  const moods = useQuery(queries.moods());
  const { radioSession, isPlaying } = usePlayerState();
  const player = usePlayerActions();

  const start = useMutation({ mutationFn: (mood: string) => player.startRadio(null, mood) });

  if (!moods.data?.length) return null;

  return (
    <Section title={t("radio.moods")}>
      <div
        style={
          {
            "--per-row": balanced(moods.data.length, 4),
            "--per-row-wide": balanced(moods.data.length, 8),
          } as CSSProperties
        }
        className={cn(
          "grid grid-cols-[repeat(var(--per-row),minmax(0,1fr))] gap-3 xl:grid-cols-[repeat(var(--per-row-wide),minmax(0,1fr))]",
          "max-md:-mx-4 max-md:flex max-md:overflow-x-auto max-md:px-4 max-md:[&>*]:w-36 max-md:[&>*]:shrink-0",
          hiddenScrollbar,
        )}
      >
        {moods.data.map((mood) => (
          <MoodTile
            key={mood.key}
            mood={mood}
            active={radioSession?.mood === mood.key}
            sounding={radioSession?.mood === mood.key && isPlaying}
            pending={start.isPending ? start.variables === mood.key : null}
            onStart={() => start.mutate(mood.key)}
          />
        ))}
      </div>
    </Section>
  );
}

function MoodTile({
  mood,
  active,
  sounding,
  pending,
  onStart,
}: {
  mood: Mood;
  active: boolean;
  sounding: boolean;
  pending: boolean | null;
  onStart: () => void;
}) {
  const t = useT();
  const tone = useVividTone(mood.albumIds.map((id) => coverUrl({ albumId: id, variant: "thumb" })));

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onStart}
      disabled={pending !== null}
      data-tone=""
      style={toneStyle(tone)}
      className={cn(
        "mood-tile group relative isolate flex h-30 flex-col justify-between overflow-hidden rounded-md p-3 text-left",
        "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        "disabled:cursor-progress",
        active && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
        pending === false && "opacity-60",
        pending === true && "animate-pulse",
      )}
    >
      <span className="flex items-start justify-between">
        <span aria-hidden="true" className="mood-fan">
          {mood.albumIds.map((id, index) => (
            <span key={id} className="mood-sleeve" style={{ "--i": index } as CSSProperties}>
              <AlbumCover album={{ id, title: "", hasCover: true }} />
            </span>
          ))}
          {mood.albumIds.length === 0 && (
            <span className="mood-sleeve mood-sleeve-blank">
              <MoodIcon mood={mood.key} size={20} />
            </span>
          )}
        </span>
        {sounding && <NowPlayingBars />}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 font-semibold">
        <MoodIcon
          mood={mood.key}
          size={16}
          aria-hidden="true"
          className="shrink-0 text-muted-foreground"
        />
        <span className="truncate">{moodLabel(mood.key, t)}</span>
      </span>
    </button>
  );
}

function balanced(count: number, max: number): number {
  return Math.ceil(count / Math.ceil(count / max));
}

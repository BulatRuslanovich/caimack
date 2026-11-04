// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { ReactNode } from "react";
import {
  formatArtists,
  formatAudioSpec,
  formatDuration,
  isLossless,
  genreName,
} from "@/lib/format";
import { useFormat } from "@/lib/useFormat";
import type { Track } from "@/lib/types";
import { useT } from "@/contexts/I18nContext";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent } from "./ui/dialog";

export function TrackInfoDialog({ track, onClose }: { track: Track; onClose: () => void }) {
  const t = useT();
  const format = useFormat();

  const spec = formatAudioSpec(track);
  const added = track.createdAt
    ? `${format.relativeDate(track.createdAt)}, ${format.timeOfDay(track.createdAt)}`
    : null;

  const rows: [string, ReactNode][] = [
    [t("trackInfo.artists"), formatArtists(track)],
    [t("trackInfo.album"), track.albumTitle],
    [t("trackInfo.genre"), track.genreName && genreName(track.genreName)],
    [t("trackInfo.year"), track.year?.toString()],
    [t("trackInfo.trackNumber"), track.trackNumber?.toString()],
    [t("trackInfo.discNumber"), track.discNumber?.toString()],
    [t("trackInfo.duration"), formatDuration(track.durationSeconds)],
    [
      t("trackInfo.format"),
      spec && (isLossless(track.codec) ? <Badge>{spec}</Badge> : <span>{spec}</span>),
    ],
    [t("trackInfo.file"), track.originalFileName],
    [t("trackInfo.added"), added],
    [
      t("trackInfo.lyrics"),
      track.hasLyrics ? t("trackInfo.lyricsPresent") : t("trackInfo.lyricsMissing"),
    ],
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={t("dialog.trackInfo.title")} description={track.title}>
        <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-sm max-md:grid-cols-1 max-md:gap-y-0.5">
          {rows.map(
            ([label, value]) =>
              value && (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground max-md:mt-2.5">{label}</dt>
                  <dd className="min-w-0 break-words">{value}</dd>
                </div>
              ),
          )}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

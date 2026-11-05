// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { ReactNode } from "react";
import { AudioLinesIcon, Clock3Icon, FileTextIcon, FileXIcon } from "lucide-react";
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
import { TrackCover } from "./Cover";
import { cn } from "@/lib/cn";
import { Dialog, DialogContent } from "./ui/dialog";

export function TrackInfoDialog({ track, onClose }: { track: Track; onClose: () => void }) {
  const t = useT();
  const format = useFormat();

  const spec = formatAudioSpec(track);
  const added = track.createdAt
    ? `${format.relativeDate(track.createdAt)}, ${format.timeOfDay(track.createdAt)}`
    : null;

  const release: [string, ReactNode][] = [
    [t("trackInfo.album"), track.albumTitle],
    [t("trackInfo.genre"), track.genreName && genreName(track.genreName)],
    [t("trackInfo.year"), track.year?.toString()],
    [t("trackInfo.trackNumber"), track.trackNumber?.toString()],
    [t("trackInfo.discNumber"), track.discNumber?.toString()],
  ];
  const library: [string, ReactNode][] = [
    [t("trackInfo.file"), track.originalFileName],
    [t("trackInfo.added"), added],
    [
      t("trackInfo.lyrics"),
      <span
        key="lyrics"
        className={cn(
          "inline-flex items-center gap-2",
          track.hasLyrics ? "text-primary" : "text-muted-foreground",
        )}
      >
        {track.hasLyrics ? (
          <FileTextIcon aria-hidden="true" size={15} />
        ) : (
          <FileXIcon aria-hidden="true" size={15} />
        )}
        {track.hasLyrics ? t("trackInfo.lyricsPresent") : t("trackInfo.lyricsMissing")}
      </span>,
    ],
  ];
  const hasRelease = release.some(([, value]) => value);
  const details = (rows: [string, ReactNode][]) => (
    <dl>
      {rows.map(([label, value]) =>
        value ? (
          <div key={label} className="track-info-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={t("dialog.trackInfo.title")} className="w-[min(42rem,100%)]">
        <div className="track-info-heading">
          <div className="track-info-cover">
            <TrackCover track={track} variant="full" />
          </div>
          <div className="min-w-0">
            <h2 className="track-info-title">{track.title}</h2>
            <p className="mt-1.5 text-sm break-words text-muted-foreground">
              {formatArtists(track)}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Clock3Icon aria-hidden="true" size={14} />
                <span className="sr-only">{t("trackInfo.duration")}: </span>
                {formatDuration(track.durationSeconds)}
              </span>
              {spec && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2 py-1",
                    isLossless(track.codec)
                      ? "bg-primary-soft text-primary"
                      : "bg-raised text-muted-foreground",
                  )}
                >
                  <AudioLinesIcon aria-hidden="true" size={14} />
                  <span className="sr-only">{t("trackInfo.format")}: </span>
                  {spec}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className={cn("track-info-sections", !hasRelease && "grid-cols-1")}>
          {hasRelease && (
            <section className="track-info-section">
              <h3>{t("trackInfo.release")}</h3>
              {details(release)}
            </section>
          )}
          <section className="track-info-section">
            <h3>{t("trackInfo.library")}</h3>
            {details(library)}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

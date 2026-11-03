// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { ChevronRightIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { formatArtists, formatDuration } from "@/lib/format";
import { trackCoverUrl } from "@/lib/media";
import { useFormat } from "@/lib/useFormat";
import { toneStyle, useVividTone } from "@/lib/useCoverTone";
import { usePlayback } from "@/lib/playback/usePlayback";
import type { HomeBlock } from "@/lib/types";
import { useT } from "@/contexts/I18nContext";
import { TrackCover } from "@/components/Cover";
import { PlayAllButton } from "@/components/PlayAllButton";
import { PlayBadge } from "@/components/PlayBadge";

export const HERO_PREVIEW_SIZE = 4;

const BYLINE_ARTISTS = 3;

export function leadArtists(tracks: { artistName: string }[], limit = BYLINE_ARTISTS) {
  const names = [...new Set(tracks.map((track) => track.artistName))];
  return { names: names.slice(0, limit), more: names.length > limit };
}

export function DailyMix<T extends string>({
  block,
  title,
  href,
}: {
  block: HomeBlock;
  title: string;
  href?: Route<T>;
}) {
  const t = useT();
  const format = useFormat();
  const { currentTrackId, playTrack, soundingNow } = usePlayback();

  const tracks = block.tracks ?? [];
  const lead = tracks[0];
  const collage = tracks
    .filter((track) => track.hasCover)
    .filter(
      (track, index, covered) =>
        covered.findIndex(
          (other) => (other.albumId ?? other.id) === (track.albumId ?? track.id),
        ) === index,
    )
    .slice(0, 4);

  const art = collage[0] ?? lead;
  const tone = useVividTone(
    collage.length > 0
      ? collage.map((track) => trackCoverUrl(track, "thumb"))
      : [art?.hasCover ? trackCoverUrl(art, "thumb") : null],
  );

  if (!lead) return null;

  const total = block.totalCount ?? tracks.length;
  const artists = leadArtists(tracks);
  const seconds =
    tracks.length >= total ? tracks.reduce((sum, track) => sum + track.durationSeconds, 0) : 0;

  const who = artists.more
    ? t("home.artistsAndMore", { artists: artists.names.join(", ") })
    : artists.names.join(", ");
  const size = [
    t("count.tracks", { count: total }),
    seconds > 0 ? format.totalDuration(seconds) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      data-tone=""
      style={toneStyle(tone)}
      className="daily-mix"
      aria-labelledby="daily-mix-heading"
    >
      <div className="daily-mix-header">
        <div className="daily-mix-mosaic" aria-hidden="true">
          {collage.length === 4 ? (
            collage.map((track) => <TrackCover key={track.id} track={track} />)
          ) : (
            <TrackCover track={lead} />
          )}
        </div>
        <div className="min-w-0">
          <h2 id="daily-mix-heading" className="text-xl font-semibold">
            {title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{size}</p>
        </div>
        <PlayAllButton tracks={tracks} name={title} />
      </div>
      <p className="daily-mix-artists" title={who}>
        {who}
      </p>
      <div className="daily-mix-preview">
        <p className="text-xs text-faint">{t("home.mixStartsWith")}</p>
        <ol aria-label={title}>
          {tracks.slice(0, HERO_PREVIEW_SIZE).map((track) => {
            const current = currentTrackId === track.id;
            const playing = soundingNow(track.id);
            return (
              <li key={track.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => playTrack(track, tracks)}
                  aria-label={[playing ? t("action.pause") : t("action.play"), track.title].join(
                    ": ",
                  )}
                  className="daily-preview-track group"
                >
                  <span className="relative size-10 overflow-hidden rounded-xs shadow-art">
                    <TrackCover track={track} />
                    <PlayBadge
                      size={8}
                      playing={playing}
                      visible={current}
                      className="absolute top-1 left-1"
                    />
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        "block truncate text-sm font-medium",
                        current && "text-primary",
                      )}
                      title={track.title}
                    >
                      {track.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {formatArtists(track)}
                    </span>
                  </span>
                  <span className="text-2xs text-faint tabular-nums">
                    {formatDuration(track.durationSeconds)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
      {href && (
        <Link href={href} className="daily-mix-link">
          {t("action.seeAll")}
          <ChevronRightIcon size={16} />
        </Link>
      )}
    </section>
  );
}

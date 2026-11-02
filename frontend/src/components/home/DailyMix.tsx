// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { ChevronRightIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { displayTitleClass, formatArtists, formatDuration } from "@/lib/format";
import { trackCoverUrl } from "@/lib/media";
import { useFormat } from "@/lib/useFormat";
import { toneStyle, useVividTone } from "@/lib/useCoverTone";
import { usePlayback } from "@/lib/playback/usePlayback";
import type { HomeBlock } from "@/lib/types";
import { useT } from "@/contexts/I18nContext";
import { TrackCover } from "@/components/Cover";
import { PlayAllButton } from "@/components/PlayAllButton";
import { PlayBadge } from "@/components/PlayBadge";
import { RadioButton } from "@/components/RadioButton";
import { ShuffleButton } from "@/components/ShuffleButton";

export const HERO_PREVIEW_SIZE = 3;

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

  const sounding = tracks.find((track) => soundingNow(track.id));

  return (
    <section
      data-tone=""
      style={toneStyle(tone)}
      className={cn(
        "daily-mix grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-8 gap-y-4 p-7",
        "max-md:-mx-1 max-md:gap-x-4 max-md:gap-y-3 max-md:p-4",
      )}
      aria-labelledby="daily-mix-heading"
    >
      {art.hasCover && (
        <img
          aria-hidden="true"
          alt=""
          src={trackCoverUrl(art, "thumb") ?? undefined}
          className="daily-mix-art"
        />
      )}

      <div className="daily-record row-span-2 max-md:row-span-1" data-spinning={Boolean(sounding)}>
        <div className="record" data-out="true">
          <div className="record-disc" aria-hidden="true">
            <div className="record-spin">
              <div className="record-label">
                <TrackCover track={sounding ?? lead} />
              </div>
            </div>
            <div className="record-sheen" />
          </div>
          <div className="record-sleeve">
            {collage.length === 4 ? (
              <div className="grid size-full grid-cols-2 grid-rows-2">
                {collage.map((track) => (
                  <TrackCover key={track.id} track={track} />
                ))}
              </div>
            ) : (
              <TrackCover track={lead} variant="full" />
            )}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2 self-end max-md:self-center">
        <h2
          id="daily-mix-heading"
          className={cn(
            "line-clamp-2",
            displayTitleClass(title),
            "max-xl:text-title",
            "max-md:text-[clamp(1.125rem,4.5vw,1.5rem)] max-md:leading-tight",
          )}
        >
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">
          <span className="line-clamp-2 max-md:line-clamp-1 md:inline" title={who}>
            {who}
          </span>
          <span className="max-md:hidden"> · </span>
          <span className="whitespace-nowrap max-md:block">{size}</span>
        </p>
      </div>

      <div className="col-start-2 flex flex-wrap items-center gap-2.5 self-start max-md:col-span-full max-md:col-start-1 max-md:gap-2 max-sm:[&_button]:px-3">
        <PlayAllButton tracks={tracks} name={title} />
        <ShuffleButton tracks={tracks} compact />
        <RadioButton seed={null} label={t("radio.mine")} />
      </div>

      <div className="col-span-full flex min-w-0 flex-col gap-2 border-t border-border pt-4 max-md:pt-3">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm text-muted-foreground">{t("home.mixStartsWith")}</p>
          {href && (
            <Link
              href={href}
              className="flex items-center gap-0.5 text-sm text-muted-foreground transition-colors duration-150 ease-brand hover:text-foreground hover:no-underline"
            >
              {t("action.seeAll")}
              <ChevronRightIcon size={16} />
            </Link>
          )}
        </div>
        <ol
          aria-label={title}
          className="-mx-2 grid grid-cols-3 gap-2 max-lg:grid-cols-1 max-lg:gap-0"
        >
          {tracks.slice(0, HERO_PREVIEW_SIZE).map((track) => {
            const current = currentTrackId === track.id;
            const playing = soundingNow(track.id);

            return (
              <li key={track.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => playTrack(track, tracks)}
                  aria-label={`${playing ? t("action.pause") : t("action.play")}: ${track.title}`}
                  className={cn(
                    "group grid w-full grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3 rounded-md p-2 text-left",
                    "transition-colors duration-150 ease-brand hover:bg-raised",
                    "max-lg:grid-cols-[2.5rem_minmax(0,1fr)_auto] max-lg:py-1.5",
                  )}
                >
                  <span className="relative size-11 overflow-hidden rounded-xs shadow-art max-lg:size-10">
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
                        "line-clamp-2 text-sm leading-snug font-medium",
                        current && "text-primary",
                      )}
                      title={track.title}
                    >
                      {track.title}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {formatArtists(track)}
                    </span>
                  </span>
                  <span className="text-xs text-faint tabular-nums lg:hidden">
                    {formatDuration(track.durationSeconds)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

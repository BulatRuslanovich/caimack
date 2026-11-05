// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { PauseIcon, PlayIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatArtists, genreName } from "@/lib/format";
import {
  DAYPART_HOURS,
  capitalize,
  daypartOf,
  intensity,
  leadingBlanks,
  type Daypart,
} from "@/lib/recap";
import type { Artist, Recap, Track } from "@/lib/types";
import { useFormat } from "@/lib/useFormat";
import { usePlayback } from "@/lib/playback/usePlayback";
import { useI18n, useT } from "@/contexts/I18nContext";
import { ArtistCover, TrackCover } from "@/components/Cover";
import { Button } from "@/components/ui/button";

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-sm font-semibold tracking-wide text-primary uppercase">{children}</p>;
}

const huge =
  "font-display text-[clamp(3rem,13vw,5.5rem)] leading-[0.95] font-semibold tracking-tight text-balance pb-[0.1em]";
const big =
  "font-display text-[clamp(2rem,8vw,3.25rem)] leading-tight font-semibold tracking-tight text-balance";

export function Intro({ recap, month }: { recap: Recap; month: string }) {
  const t = useT();
  const covers = recap.topTracks
    .map((item) => item.track)
    .filter((item) => item.hasCover)
    .slice(0, 4);

  return (
    <>
      {covers.length > 0 && (
        <div className="flex -space-x-10">
          {covers.map((item, position) => (
            <span
              key={item.id}
              className="size-28 overflow-hidden rounded-xs shadow-art max-sm:size-24"
              style={{ transform: `rotate(${(position - (covers.length - 1) / 2) * 6}deg)` }}
            >
              <TrackCover track={item} />
            </span>
          ))}
        </div>
      )}
      <h1 className={huge}>{t("recap.intro.title", { month })}</h1>
      <p className="text-xl text-muted-foreground">{t("recap.intro.note")}</p>
    </>
  );
}

export function Time({ recap }: { recap: Recap }) {
  const t = useT();
  const format = useFormat();
  const delta =
    recap.previousListenedSeconds == null
      ? null
      : recap.listenedSeconds - recap.previousListenedSeconds;

  return (
    <>
      <Eyebrow>{t("recap.time.eyebrow")}</Eyebrow>
      <p className={cn(huge, "tabular-nums")}>{format.totalDuration(recap.listenedSeconds)}</p>
      <p className="text-2xl text-muted-foreground">{t("recap.time.ofMusic")}</p>
      <ul className="flex flex-col gap-1 text-lg">
        <li>{t("recap.plays", { count: recap.plays })}</li>
        <li>{t("count.tracks", { count: recap.distinctTracks })}</li>
        <li>{t("count.artists", { count: recap.distinctArtists })}</li>
      </ul>
      {delta !== null && Math.abs(delta) >= 60 && (
        <p className="text-muted-foreground">
          {t(delta > 0 ? "recap.time.more" : "recap.time.less", {
            duration: format.totalDuration(Math.abs(delta)),
          })}
        </p>
      )}
    </>
  );
}

export function TopArtist({ recap }: { recap: Recap }) {
  const t = useT();
  const format = useFormat();
  const [lead, ...rest] = recap.topArtists;

  return (
    <>
      <Eyebrow>{t("recap.artist.eyebrow")}</Eyebrow>
      <span className="size-[min(16rem,55vw)] overflow-hidden rounded-full shadow-art">
        <ArtistCover artist={lead.artist} variant="full" />
      </span>
      <h2 className={big}>{lead.artist.name}</h2>
      <p className="text-lg text-muted-foreground">
        {t("recap.artist.together", { duration: format.totalDuration(lead.listenedSeconds) })},{" "}
        {t("recap.plays", { count: lead.plays })}
      </p>
      <Runners title={t("recap.alsoTop")} names={rest.map((item) => item.artist.name)} />
    </>
  );
}

export function TopTrack({ recap }: { recap: Recap }) {
  const t = useT();
  const [lead, ...rest] = recap.topTracks;
  const tracks = recap.topTracks.map((item) => item.track);

  return (
    <>
      <Eyebrow>{t("recap.track.eyebrow")}</Eyebrow>
      <PlayableCover track={lead.track} context={tracks} />
      <div>
        <h2 className={big}>{lead.track.title}</h2>
        <p className="text-lg text-muted-foreground">
          {formatArtists(lead.track)} · {t("recap.times", { count: lead.plays })}
        </p>
      </div>
      <Runners title={t("recap.alsoTop")} names={rest.map((item) => item.track.title)} />
    </>
  );
}

function Runners({ title, names }: { title: string; names: string[] }) {
  if (names.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-sm text-muted-foreground">{title}</p>
      <ol className="flex flex-col gap-0.5 text-lg">
        {names.map((name, position) => (
          <li key={`${position}-${name}`} className="truncate">
            <span className="mr-3 text-faint tabular-nums">{position + 2}</span>
            {name}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PlayableCover({ track, context }: { track: Track; context: Track[] }) {
  const t = useT();
  const { playTrack, soundingNow } = usePlayback();
  const playing = soundingNow(track.id);

  return (
    <button
      type="button"
      onClick={() => playTrack(track, context)}
      aria-label={`${playing ? t("action.pause") : t("action.play")}: ${track.title}`}
      className="group relative size-[min(16rem,55vw)] overflow-hidden rounded-xs shadow-art"
    >
      <TrackCover track={track} variant="full" />
      <span className="absolute right-3 bottom-3 grid size-14 place-items-center rounded-full bg-action text-action-foreground shadow-pop transition-transform duration-150 ease-brand group-hover:scale-105">
        {playing ? (
          <PauseIcon size={24} />
        ) : (
          <PlayIcon size={24} className="translate-x-px fill-current" />
        )}
      </span>
    </button>
  );
}

export function BusiestDay({
  recap,
  peak,
}: {
  recap: Recap;
  peak: { day: number; seconds: number };
}) {
  const t = useT();
  const { locale } = useI18n();
  const format = useFormat();
  const max = peak.seconds;
  const blanks = leadingBlanks(recap.year, recap.month);

  const date = new Date(recap.year, recap.month - 1, peak.day);
  const weekday = date.toLocaleDateString(locale, { weekday: "long" });

  return (
    <>
      <Eyebrow>{t("recap.day.eyebrow")}</Eyebrow>
      <h2 className={big}>{date.toLocaleDateString(locale, { day: "numeric", month: "long" })}</h2>
      <p className="text-lg text-muted-foreground">
        {capitalize(weekday)} ·{" "}
        {t("recap.day.note", { duration: format.totalDuration(peak.seconds) })}
      </p>
      <div className="grid max-w-sm grid-cols-7 gap-1.5" aria-hidden="true">
        {Array.from({ length: blanks }, (_, position) => (
          <span key={`blank-${position}`} />
        ))}
        {recap.daySeconds.map((seconds, position) => {
          const level = intensity(seconds, max);

          return (
            <span
              key={position}
              className={cn(
                "grid aspect-square place-items-center rounded-sm bg-foreground/8 text-2xs tabular-nums",
                level > 0.6 ? "text-primary-foreground" : "text-muted-foreground",
                position + 1 === peak.day && "ring-2 ring-foreground",
              )}
              style={
                level > 0
                  ? {
                      backgroundColor: `color-mix(in oklab, var(--color-primary) ${Math.round(20 + level * 80)}%, transparent)`,
                    }
                  : undefined
              }
            >
              {position + 1}
            </span>
          );
        })}
      </div>
    </>
  );
}

export function Hours({
  hourSeconds,
  daypart,
  share,
}: {
  hourSeconds: number[];
  daypart: Daypart;
  share: number;
}) {
  const t = useT();
  const [from, to] = DAYPART_HOURS[daypart];
  const max = Math.max(...hourSeconds);

  return (
    <>
      <Eyebrow>{t("recap.hours.eyebrow")}</Eyebrow>
      <h2 className={big}>{t(`recap.hours.${daypart}`)}</h2>
      <p className="text-lg text-muted-foreground">
        {t("recap.hours.note", {
          share: Math.round(share * 100),
          from: String(from).padStart(2, "0"),
          to: String(to).padStart(2, "0"),
        })}
      </p>
      <div className="flex flex-col gap-2" aria-hidden="true">
        <div className="flex h-40 items-end gap-1">
          {hourSeconds.map((seconds, hour) => (
            <span
              key={hour}
              className={cn(
                "flex-1 rounded-t-xs",
                daypartOf(hour) === daypart ? "bg-primary" : "bg-foreground/25",
              )}
              style={{ height: `${Math.max(3, max > 0 ? (seconds / max) * 100 : 0)}%` }}
            />
          ))}
        </div>
        <div className="grid grid-cols-4 text-xs text-faint tabular-nums">
          {["00", "06", "12", "18"].map((hour) => (
            <span key={hour}>{hour}</span>
          ))}
        </div>
      </div>
    </>
  );
}

export function Sound({ track }: { track: Track }) {
  const t = useT();

  return (
    <>
      <Eyebrow>{t("recap.sound.eyebrow")}</Eyebrow>
      <PlayableCover track={track} context={[track]} />
      <div>
        <h2 className={big}>{track.title}</h2>
        <p className="text-lg text-muted-foreground">{formatArtists(track)}</p>
      </div>
      <p className="text-muted-foreground">{t("recap.sound.note")}</p>
    </>
  );
}

export function Discoveries({ count, picks }: { count: number; picks: Artist[] }) {
  const t = useT();

  return (
    <>
      <Eyebrow>{t("recap.discoveries.eyebrow")}</Eyebrow>
      {count === 0 ? (
        <>
          <h2 className={big}>{t("recap.discoveries.none")}</h2>
          <p className="text-lg text-muted-foreground">{t("recap.discoveries.noneNote")}</p>
        </>
      ) : (
        <>
          <p className={cn(huge, "tabular-nums")}>{count}</p>
          <p className="text-2xl text-muted-foreground">{t("recap.newArtists", { count })}</p>
        </>
      )}
      {picks.length > 0 && (
        <ul className="flex flex-wrap gap-5">
          {picks.map((artist) => (
            <li key={artist.id} className="flex w-24 flex-col items-center gap-2 text-center">
              <span className="size-24 overflow-hidden rounded-full">
                <ArtistCover artist={artist} />
              </span>
              <span className="line-clamp-2 text-sm">{artist.name}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function Summary({
  recap,
  month,
  onClose,
  onRestart,
}: {
  recap: Recap;
  month: string;
  onClose: () => void;
  onRestart: () => void;
}) {
  const t = useT();
  const format = useFormat();

  const facts = [
    [t("recap.summary.artist"), recap.topArtists[0]?.artist.name],
    [t("recap.summary.track"), recap.topTracks[0]?.track.title],
    [t("recap.summary.genre"), recap.topGenre && genreName(recap.topGenre)],
  ].filter((fact): fact is [string, string] => Boolean(fact[1]));

  return (
    <>
      <Eyebrow>{t("recap.summary.eyebrow", { month: capitalize(month) })}</Eyebrow>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
        <div className="col-span-2">
          <dt className="text-sm text-muted-foreground">{t("recap.summary.time")}</dt>
          <dd className="font-display text-5xl font-semibold tracking-tight tabular-nums">
            {format.totalDuration(recap.listenedSeconds)}
          </dd>
        </div>
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="line-clamp-2 font-display text-2xl font-semibold tracking-tight">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2.5">
        <Button variant="primary" onClick={onClose}>
          {t("recap.close")}
        </Button>
        <Button onClick={onRestart}>{t("recap.again")}</Button>
      </div>
    </>
  );
}

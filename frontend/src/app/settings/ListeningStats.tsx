// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArrowLeftIcon, ChevronDownIcon, ChevronRightIcon, ChevronUpIcon } from "lucide-react";
import { ArtistCover, TrackCover } from "@/components/Cover";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/Loading";
import { useI18n } from "@/contexts/I18nContext";
import { formatArtists } from "@/lib/format";
import {
  LISTENING_VIEWS,
  listeningDate,
  listeningLink,
  listeningRange,
  type ListeningView,
} from "@/lib/listeningStats";
import { usePlayback } from "@/lib/playback/usePlayback";
import { PlaySource } from "@/lib/playback/playSource";
import { queries } from "@/lib/queries";
import type { ListeningWeek } from "@/lib/types";

export function ListeningStats() {
  return (
    <PlaySource value="listening">
      <ListeningStatsContent />
    </PlaySource>
  );
}

function ListeningStatsContent() {
  const stats = useQuery(queries.listeningStats());
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const [archiveSize, setArchiveSize] = useState(4);
  const playback = usePlayback();
  const rawView = params.get("view");
  const view = LISTENING_VIEWS.find((view) => view === rawView) ?? "overview";
  const data = stats.data;
  const week = data?.weeks.find((week) => week.startDate === params.get("week")) ?? data?.weeks[0];
  if (!data || !week)
    return stats.isError ? (
      <div role="alert" className="space-y-4">
        <p>{t("error.load")}</p>
        <Button onClick={() => void stats.refetch()}>{t("action.tryAgain")}</Button>
      </div>
    ) : (
      <Loading />
    );

  const minutes = Math.floor(week.listenedSeconds / 60).toLocaleString(locale);
  const past = data.weeks.filter(
    (old) => !old.current && old.listenedSeconds > 0 && old.startDate !== week.startDate,
  );
  const title =
    view === "overview"
      ? t("listening.title")
      : view === "minutes"
        ? t("listening.minutes")
        : view === "artists"
          ? t("listening.artists")
          : view === "songs"
            ? t("listening.songs")
            : t("listening.insights");
  const empty = data.weeks.every((week) => week.listenedSeconds === 0);
  return (
    <section className="listening-stats" aria-label={t("listening.title")}>
      <div className="stats-page-heading">
        {(view !== "overview" || !week.current) && (
          <Link
            href={listeningLink(view === "overview" ? "" : week.startDate)}
            className="stats-icon-button"
            aria-label={t("listening.back")}
          >
            <ArrowLeftIcon size={22} />
          </Link>
        )}
        <h2>{title}</h2>
      </div>
      {stats.isError && <p role="alert">{t("error.load")}</p>}
      <div className="stats-week-heading">
        <div>
          {view === "overview" && (
            <div className="stats-heading-line">
              <h3>{t(week.current ? "listening.thisWeek" : "listening.week")}</h3>
            </div>
          )}
          <p>{listeningRange(week, locale)}</p>
        </div>
      </div>

      {view === "overview" ? (
        <>
          {week.listenedSeconds === 0 ? (
            <div className="stats-empty">
              <h3>{t(empty ? "listening.empty" : "listening.noWeek")}</h3>
              <p>{t(empty ? "listening.emptyHint" : "listening.noWeekHint")}</p>
            </div>
          ) : (
            <>
              <div className="stats-tiles">
                <div className="stats-tile-column">
                  <Tile week={week} view="minutes" label={t("listening.minutes")}>
                    <strong className="stats-minutes-number">{minutes}</strong>
                  </Tile>
                  {week.topArtists[0] && (
                    <Tile week={week} view="artists" label={t("listening.topArtist")}>
                      <strong>{week.topArtists[0].artist.name}</strong>
                      <div className="stats-artist-cover">
                        <ArtistCover artist={week.topArtists[0].artist} variant="full" />
                      </div>
                    </Tile>
                  )}
                </div>
                <div className="stats-tile-column">
                  <Tile week={week} view="songs" label={t("listening.week")}>
                    <span className="stats-count">
                      {t("listening.songsCount", { count: week.distinctTracks })}
                    </span>
                    <span className="stats-muted">
                      {t("listening.artistsCount", { count: week.distinctArtists })}
                    </span>
                  </Tile>
                  {week.topTracks[0] && (
                    <Tile week={week} view="songs" label={t("listening.topSong")}>
                      <strong>{week.topTracks[0].track.title}</strong>
                      <div className="stats-song-cover">
                        <TrackCover track={week.topTracks[0].track} variant="full" />
                      </div>
                    </Tile>
                  )}
                </div>
              </div>
              <h3 className="stats-section-heading">{t("listening.insights")}</h3>
              <div className="stats-insights">
                <Insight week={week} kind={week.decade === null ? "variety" : "decade"} />
                {week.topArtists[0] && <Insight week={week} kind="artistShare" />}
              </div>
            </>
          )}
          {past.length > 0 && (
            <>
              <h3 className="stats-section-heading">{t("listening.pastWeeks")}</h3>
              <div className="stats-archive">
                {past.slice(0, archiveSize).map((old) => (
                  <Link
                    key={old.startDate}
                    href={listeningLink(old.startDate)}
                    className="stats-archive-week"
                  >
                    {old.topTracks[0] && (
                      <span className="stats-archive-cover">
                        <TrackCover track={old.topTracks[0].track} />
                      </span>
                    )}
                    <span className="stats-archive-text">
                      <strong>{listeningRange(old, locale)}</strong>
                      <span>{old.topTracks[0]?.track.title}</span>
                      <span>
                        {t("listening.plays", { count: old.topTracks[0]?.plays ?? old.plays })}
                      </span>
                    </span>
                    <ChevronRightIcon size={24} />
                  </Link>
                ))}
                {past.length > archiveSize && (
                  <Button variant="ghost" onClick={() => setArchiveSize((size) => size + 4)}>
                    {t("listening.more")}
                  </Button>
                )}
              </div>
            </>
          )}
        </>
      ) : view === "minutes" ? (
        <>
          <Hero text={t("listening.youMinutes", { minutes })} highlight={minutes} />
          <h3 className="stats-section-heading">{t("listening.days")}</h3>
          <div className="stats-days" role="img" aria-label={t("listening.days")}>
            {week.daySeconds.map((seconds, index) => {
              const date = listeningDate(week.startDate);
              date.setUTCDate(date.getUTCDate() + index);
              const day = new Intl.DateTimeFormat(locale, {
                weekday: "short",
                timeZone: "UTC",
              }).format(date);
              const value = Math.floor(seconds / 60).toLocaleString(locale);
              return (
                <div className="stats-day" key={index} aria-label={`${day}: ${value}`}>
                  <span>{value}</span>
                  <div
                    style={{
                      height: `${Math.max(2, (seconds / Math.max(1, ...week.daySeconds)) * 140)}px`,
                    }}
                  />
                  <span>{day}</span>
                </div>
              );
            })}
          </div>
          {week.previousListenedSeconds !== null && (
            <p className="stats-muted">
              {t("listening.previous", {
                minutes: Math.floor(week.previousListenedSeconds / 60).toLocaleString(locale),
              })}
            </p>
          )}
          <p>{t("listening.plays", { count: week.plays })}</p>
        </>
      ) : view === "artists" || view === "songs" ? (
        <>
          <Hero
            text={t(view === "artists" ? "listening.youArtists" : "listening.youSongs", {
              count: view === "artists" ? week.distinctArtists : week.distinctTracks,
            })}
            highlight={(view === "artists"
              ? week.distinctArtists
              : week.distinctTracks
            ).toLocaleString(locale)}
          />
          <ol className="stats-ranking">
            {view === "artists"
              ? week.topArtists.map((item, index) => (
                  <li key={item.artist.id}>
                    <Link href={`/artists/${item.artist.id}`} className="stats-ranked-item">
                      <Rank rank={index + 1} previous={item.previousRank} />
                      <span className="stats-ranked-cover stats-artist-cover">
                        <ArtistCover artist={item.artist} variant="full" />
                      </span>
                      <span className="stats-ranked-text">
                        <strong>{item.artist.name}</strong>
                        <span>
                          {t("listening.duration", {
                            minutes: Math.floor(item.listenedSeconds / 60).toLocaleString(locale),
                          })}
                        </span>
                        {item.weeksInTop5 > 0 && (
                          <span>{t("listening.topWeeks", { count: item.weeksInTop5 })}</span>
                        )}
                      </span>
                      <ChevronRightIcon size={18} />
                    </Link>
                  </li>
                ))
              : week.topTracks.map((item, index) => (
                  <li key={item.track.id}>
                    <button
                      className="stats-ranked-item"
                      onClick={() =>
                        playback.playTrack(
                          item.track,
                          week.topTracks.map((item) => item.track),
                        )
                      }
                    >
                      <Rank rank={index + 1} previous={item.previousRank} />
                      <span className="stats-ranked-cover">
                        <TrackCover track={item.track} variant="full" />
                      </span>
                      <span className="stats-ranked-text">
                        <strong>{item.track.title}</strong>
                        <span>{formatArtists(item.track)}</span>
                        <span>{t("listening.plays", { count: item.plays })}</span>
                        {item.weeksInTop5 > 0 && (
                          <span>{t("listening.topWeeks", { count: item.weeksInTop5 })}</span>
                        )}
                      </span>
                      <ChevronRightIcon size={18} />
                    </button>
                  </li>
                ))}
          </ol>
        </>
      ) : (
        <div className="stats-insight-detail">
          <Insight week={week} kind={view} expanded />
          <p>{insightNote(week, view, t)}</p>
          {view === "artistShare" && week.topArtists[0] && (
            <Link href={`/artists/${week.topArtists[0].artist.id}`}>
              {week.topArtists[0].artist.name} →
            </Link>
          )}
        </div>
      )}

      {view === "overview" && week.current && (
        <footer className="stats-footer">
          <Button variant="ghost" disabled={stats.isFetching} onClick={() => void stats.refetch()}>
            {t("listening.refresh")}
          </Button>
        </footer>
      )}
    </section>
  );
}

function Tile({
  week,
  view,
  label,
  children,
}: {
  week: ListeningWeek;
  view: ListeningView;
  label: string;
  children: ReactNode;
}) {
  return (
    <Link href={listeningLink(week.startDate, view)} className="stats-tile">
      <span className="stats-tile-label">
        {label}
        <ChevronRightIcon size={18} />
      </span>
      {children}
    </Link>
  );
}

function Hero({ text, highlight }: { text: string; highlight: string }) {
  const at = text.indexOf(highlight);
  return (
    <h3 className="stats-hero">
      {at < 0 ? (
        text
      ) : (
        <>
          {text.slice(0, at)}
          <span>{highlight}</span>
          {text.slice(at + highlight.length)}
        </>
      )}
    </h3>
  );
}

function Rank({ rank, previous }: { rank: number; previous: number | null }) {
  const { t } = useI18n();
  return (
    <span className="stats-rank" aria-label={t("listening.rank", { count: rank })}>
      {previous !== null &&
        previous !== rank &&
        (previous > rank ? (
          <ChevronUpIcon
            size={18}
            className="text-success"
            aria-label={t("listening.movedUp", { count: previous - rank })}
          />
        ) : (
          <ChevronDownIcon
            size={18}
            className="text-destructive"
            aria-label={t("listening.movedDown", { count: rank - previous })}
          />
        ))}
      {rank}
    </span>
  );
}

type Translate = ReturnType<typeof useI18n>["t"];
function insightNote(week: ListeningWeek, kind: string, t: Translate) {
  return kind === "decade"
    ? t("listening.decadeNote", { share: week.decadeShare ?? 0, decade: String(week.decade) })
    : kind === "artistShare"
      ? t("listening.artistNote", {
          share: week.artistShare ?? 0,
          artist: week.topArtists[0]?.artist.name ?? "",
        })
      : t("listening.varietyNote", { songs: week.distinctTracks, artists: week.distinctArtists });
}

function Insight({
  week,
  kind,
  expanded = false,
}: {
  week: ListeningWeek;
  kind: string;
  expanded?: boolean;
}) {
  const { t } = useI18n();
  const title =
    kind === "decade"
      ? t("listening.decade", { decade: String(week.decade) })
      : kind === "artistShare"
        ? t("listening.artistShare", { share: week.artistShare ?? 0 })
        : t("listening.variety");
  const content = (
    <>
      <div className="stats-insight-art">
        {kind === "artistShare" && week.topArtists[0] ? (
          <ArtistCover artist={week.topArtists[0].artist} variant="full" />
        ) : (
          <div className="stats-collage">
            {week.topTracks.slice(0, 3).map((item) => (
              <span key={item.track.id}>
                <TrackCover track={item.track} />
              </span>
            ))}
          </div>
        )}
      </div>
      <strong>{title}</strong>
      {expanded && <span>{insightNote(week, kind, t)}</span>}
    </>
  );
  const className = `stats-insight ${kind === "artistShare" ? "stats-insight-pink" : "stats-insight-green"}`;
  return expanded ? (
    <div className={className}>{content}</div>
  ) : (
    <Link href={listeningLink(week.startDate, kind as ListeningView)} className={className}>
      {content}
    </Link>
  );
}

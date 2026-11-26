// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import { PrefetchLink as Link } from "@/components/PrefetchLink";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PlaySource } from "@/lib/playback/playSource";
import { queries } from "@/lib/queries";
import { useShelfImpression } from "@/lib/useShelfImpression";
import { formatArtists } from "@/lib/format";
import { coverUrl, trackCoverUrl } from "@/lib/media";
import { useTone } from "@/lib/useCoverTone";
import type { HomeBlock, Track } from "@/lib/types";
import { PlayingGlyph } from "@/components/PlaybackIndicators";
import { usePlayback } from "@/lib/playback/usePlayback";
import { useNowPlaying } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { Section } from "@/components/PageHeader";
import { AlbumCover, TrackCover } from "../Cover";
import { CardPlayButton } from "../MediaCard";
import { PlayBadge } from "../PlayBadge";

export function QuickTiles({ blocks }: { blocks: HomeBlock[] }) {
  const t = useT();
  const ref = useShelfImpression<HTMLElement>("home:quickTiles");

  const tiles = blocks
    .filter((block) => block.layout !== "Tile")
    .flatMap((block) =>
      recentTiles(block).map((tile) => (
        <PlaySource key={`${block.key}:${tile.key}`} value={`home:${block.baseKey}`}>
          {tile}
        </PlaySource>
      )),
    );

  if (!tiles.length) return null;

  return (
    <Section ref={ref} className="home-recent" title={t("home.quickPicks")} href="/recently-played">
      <div className="home-quick-access">{tiles.slice(0, 4)}</div>
    </Section>
  );
}

function recentTiles(block: HomeBlock) {
  const tracks = block.tracks ?? [];

  return [
    ...(block.albums ?? []).map((album) => <AlbumTile key={album.id} album={album} />),
    ...tracks.map((track) => <TrackTile key={track.id} track={track} context={tracks} />),
  ];
}

function AlbumTile({ album }: { album: NonNullable<HomeBlock["albums"]>[number] }) {
  const client = useQueryClient();
  const { currentAlbumId } = useNowPlaying();
  const detail = useQuery({ ...queries.album(album.id), enabled: currentAlbumId === album.id });

  return (
    <Tile
      href={`/albums/${album.id}`}
      label={album.title}
      sublabel={album.artistName}
      art={<AlbumCover album={album} />}
      toneSrc={coverUrl({ albumId: album.id, hasCover: album.hasCover, variant: "thumb" })}
      play={
        <CardPlayButton
          name={album.title}
          sourceCollection={{ kind: "album", id: album.id }}
          tracks={detail.data?.tracks}
          load={async () => (await client.fetchQuery(queries.album(album.id))).tracks}
          size={8}
          className="quick-tile-play"
        />
      }
    />
  );
}

function TrackTile({ track, context }: { track: Track; context: Track[] }) {
  const { currentTrackId, playTrack, soundingNow } = usePlayback();
  const t = useT();
  const isCurrent = currentTrackId === track.id;
  const playing = soundingNow(track.id);

  return (
    <Tile
      current={isCurrent}
      actionLabel={[
        playing ? t("action.pause") : t("action.play"),
        track.title,
        formatArtists(track),
      ].join(": ")}
      label={track.title}
      sublabel={formatArtists(track)}
      onClick={() => playTrack(track, context)}
      art={<TrackCover track={track} />}
      toneSrc={trackCoverUrl(track, "thumb")}
      action={
        <PlayBadge
          size={8}
          playing={playing}
          visible={isCurrent}
          className="quick-tile-play-badge"
        />
      }
    />
  );
}

function Tile<T extends string>({
  href,
  onClick,
  actionLabel,
  art,
  label,
  sublabel,
  current = false,
  action,
  toneSrc,
  play,
}: {
  href?: Route<T>;
  onClick?: () => void;
  actionLabel?: string;
  art: ReactNode;
  label: string;
  sublabel?: ReactNode;
  current?: boolean;
  action?: ReactNode;
  toneSrc?: string | null;
  play?: ReactNode;
}) {
  const tone = useTone<HTMLDivElement>(toneSrc);

  const body = (
    <>
      <span className="quick-tile-art size-14 shrink-0 overflow-hidden">{art}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-start gap-1.5 text-sm leading-snug">
          <span
            className={cn(
              "line-clamp-2 min-w-0 wrap-anywhere font-medium",
              current && "text-primary",
            )}
            title={label}
          >
            {label}
          </span>
          <PlayingGlyph />
        </span>
        {sublabel && <span className="truncate text-xs text-muted-foreground">{sublabel}</span>}
      </span>
      {action}
    </>
  );

  const shell =
    "quick-tile flex min-h-16 w-full items-center gap-3 overflow-hidden rounded-sm py-1 pr-3 text-left transition-colors duration-150 ease-brand hover:no-underline";

  return (
    <div {...tone} className="group relative min-w-0">
      {href ? (
        <Link href={href} className={shell}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onClick} aria-label={actionLabel} className={shell}>
          {body}
        </button>
      )}
      {play}
    </div>
  );
}

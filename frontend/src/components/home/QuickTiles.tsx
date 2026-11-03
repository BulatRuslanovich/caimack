// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { HeartIcon, ListMusicIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PlaySource } from "@/lib/playback/playSource";
import { queries } from "@/lib/queries";
import { useShelfImpression } from "@/lib/useShelfImpression";
import { formatArtists } from "@/lib/format";
import { coverUrl, playlistCoverUrl, trackCoverUrl } from "@/lib/media";
import { useTone } from "@/lib/useCoverTone";
import type { HomeBlock, Track } from "@/lib/types";
import { usePlayback } from "@/lib/playback/usePlayback";
import { useNowPlaying } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { capFourOnMobile } from "@/components/home/layout";
import { CoverMosaic } from "@/components/collection/CoverMosaic";
import { AlbumCover, PlaylistCover, TrackCover } from "../Cover";
import { CardPlayButton } from "../MediaCard";
import { PlayBadge } from "../PlayBadge";

export function tileLayout(count: number): { perRow: number; visible: number } {
  if (count <= 4) return { perRow: Math.max(count, 1), visible: count };

  const best = [4, 3]
    .map((perRow) => ({ perRow, visible: Math.min(2, Math.floor(count / perRow)) * perRow }))
    .sort((a, b) => b.visible - a.visible || b.perRow - a.perRow)[0];

  return best;
}

export function QuickTiles({ blocks }: { blocks: HomeBlock[] }) {
  const ref = useShelfImpression<HTMLDivElement>("home:quickTiles");

  const tiles = blocks.flatMap((block) =>
    block.layout === "Tile"
      ? [<FavoritesTile key={block.key} block={block} />]
      : recentTiles(block).map((tile) => (
          <PlaySource key={tile.key} value={`home:${block.baseKey}`}>
            {tile}
          </PlaySource>
        )),
  );

  const { perRow, visible } = tileLayout(tiles.length);

  return (
    <div
      ref={ref}
      className={cn(
        "home-quick-access grid gap-2 max-md:grid-cols-1",
        "grid-cols-[repeat(var(--per-row),minmax(0,1fr))] max-lg:grid-cols-2",
        capFourOnMobile,
      )}
      style={{ "--per-row": perRow } as CSSProperties}
    >
      {tiles.slice(0, visible)}
    </div>
  );
}

function FavoritesTile({ block }: { block: HomeBlock }) {
  const t = useT();
  const tracks = block.tracks ?? [];

  return (
    <Tile
      href="/favorites"
      label={t("home.likedSongs")}
      sublabel={t("count.tracks", { count: block.totalCount ?? tracks.length })}
      art={<CoverMosaic tracks={tracks} />}
      toneSrc={tracks[0] ? trackCoverUrl(tracks[0], "thumb") : null}
      action={<HeartIcon size={16} className="shrink-0 fill-current text-primary" />}
    />
  );
}

function recentTiles(block: HomeBlock) {
  const tracks = block.tracks ?? [];

  return [
    ...(block.albums ?? []).map((album) => <AlbumTile key={album.id} album={album} />),
    ...tracks.map((track) => <TrackTile key={track.id} track={track} context={tracks} />),
    ...(block.playlists ?? []).map((playlist) => (
      <PlaylistTile key={playlist.id} playlist={playlist} />
    )),
  ];
}

function AlbumTile({ album }: { album: NonNullable<HomeBlock["albums"]>[number] }) {
  const client = useQueryClient();
  const { currentAlbumId, isPlaying } = useNowPlaying();

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
          playing={isPlaying && currentAlbumId === album.id}
          load={async () => (await client.fetchQuery(queries.album(album.id))).tracks}
          size={8}
          className="quick-tile-play top-1/2 left-4 -translate-y-1/2 [@media(hover:none)]:hidden"
        />
      }
    />
  );
}

function TrackTile({ track, context }: { track: Track; context: Track[] }) {
  const { currentTrackId, playTrack, soundingNow } = usePlayback();
  const isCurrent = currentTrackId === track.id;

  return (
    <Tile
      current={isCurrent}
      label={track.title}
      sublabel={formatArtists(track)}
      onClick={() => playTrack(track, context)}
      art={<TrackCover track={track} />}
      toneSrc={trackCoverUrl(track, "thumb")}
      action={<PlayBadge size={8} playing={soundingNow(track.id)} visible={isCurrent} />}
    />
  );
}

function PlaylistTile({ playlist }: { playlist: NonNullable<HomeBlock["playlists"]>[number] }) {
  const t = useT();
  const client = useQueryClient();

  return (
    <Tile
      href={`/playlists/${playlist.id}`}
      label={playlist.name}
      sublabel={t("count.tracks", { count: playlist.trackCount })}
      art={<PlaylistCover playlist={playlist} fallback={<ListMusicIcon />} />}
      toneSrc={playlistCoverUrl({
        playlistId: playlist.id,
        hasCover: playlist.hasCover,
        coverTrackId: playlist.coverTrackId,
        variant: "thumb",
      })}
      play={
        playlist.trackCount > 0 && (
          <CardPlayButton
            name={playlist.name}
            playing={false}
            load={async () => (await client.fetchQuery(queries.playlist(playlist.id))).tracks}
            size={8}
            className="quick-tile-play top-1/2 left-4 -translate-y-1/2 [@media(hover:none)]:hidden"
          />
        )
      }
    />
  );
}

function Tile<T extends string>({
  href,
  onClick,
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
        <span
          className={cn("line-clamp-2 text-sm leading-snug font-medium", current && "text-primary")}
          title={label}
        >
          {label}
        </span>
        {sublabel && <span className="truncate text-xs text-muted-foreground">{sublabel}</span>}
      </span>
      {action}
    </>
  );

  const shell =
    "quick-tile flex min-h-16 w-full items-center gap-3 overflow-hidden rounded-sm bg-card py-1 pr-3 text-left transition-colors duration-150 ease-brand hover:bg-raised hover:no-underline";

  return (
    <div {...tone} className="group relative min-w-0">
      {href ? (
        <Link href={href} className={shell}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={shell}>
          {body}
        </button>
      )}
      {play}
    </div>
  );
}

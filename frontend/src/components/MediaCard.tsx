// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { queries } from "@/lib/queries";
import type { Album, Artist, Playlist, Track } from "@/lib/types";
import { usePlayback } from "@/lib/playback/usePlayback";
import { useNowPlaying } from "@/contexts/PlayerContext";
import { useFormat } from "@/lib/useFormat";
import { artistImageUrl, coverUrl, playlistCoverUrl } from "@/lib/media";
import { useTone } from "@/lib/useCoverTone";
import { useT } from "@/contexts/I18nContext";
import { AlbumCover, ArtistCover, PlaylistCover } from "./Cover";
import { ListMusicIcon } from "lucide-react";
import { BufferingRing } from "./PlaybackIndicators";
import { PlayBadge } from "./PlayBadge";

export function Card<T extends string>({
  href,
  onClick,
  active = false,
  prefetch,
  cover,
  title,
  subtitle,
  round = false,
  bare = false,
  current = false,
  action,
  toneSrc,
}: {
  href?: Route<T>;
  onClick?: () => void;
  active?: boolean;
  prefetch?: () => void;
  cover: ReactNode;
  title: string;
  subtitle: ReactNode;
  round?: boolean;
  bare?: boolean;
  current?: boolean;
  action?: ReactNode;
  toneSrc?: string | null | (string | null)[];
}) {
  const tone = useTone<HTMLElement>(toneSrc);

  const body = (
    <>
      <div
        className={cn(
          "card-art relative mb-3.5 aspect-square w-full overflow-hidden rounded-xs bg-accent",
          round && "rounded-full",
        )}
      >
        {cover}
      </div>
      <span
        title={title}
        className={cn("line-clamp-2 text-sm leading-snug font-medium", current && "text-primary")}
      >
        {title}
      </span>
      <span className="library-secondary line-clamp-2 text-sm leading-snug">{subtitle}</span>
    </>
  );

  const shell = cn(
    "flex min-w-0 flex-col gap-1 text-left hover:no-underline",
    bare && "items-center text-center",
    active && "[&>div:first-child]:ring-2 [&>div:first-child]:ring-primary",
  );

  if (href) {
    return (
      <div {...tone} data-round={round} className="media-card group relative flex min-w-0 flex-col">
        <Link
          href={href}
          prefetch={false}
          className={cn(shell, "flex-1")}
          onMouseEnter={prefetch}
          onFocus={prefetch}
        >
          {body}
        </Link>

        {action && (
          <div className="card-art-overlay pointer-events-none absolute inset-x-0 top-0 aspect-square">
            {action}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      {...tone}
      type="button"
      data-round={round}
      onClick={onClick}
      aria-pressed={active || undefined}
      className={cn("media-card group relative", shell)}
    >
      {body}
    </button>
  );
}

export function AlbumCard({ album }: { album: Album }) {
  const client = useQueryClient();
  const { currentAlbumId, isPlaying } = useNowPlaying();
  const prefetch = () => void client.prefetchQuery(queries.album(album.id));

  const playing = isPlaying && currentAlbumId === album.id;

  return (
    <Card
      href={`/albums/${album.id}`}
      prefetch={prefetch}
      title={album.title}
      subtitle={album.year ? `${album.artistName}, ${album.year}` : album.artistName}
      cover={<AlbumCover album={album} />}
      toneSrc={coverUrl({ albumId: album.id, hasCover: album.hasCover, variant: "thumb" })}
      action={
        <CardPlayButton
          name={album.title}
          playing={playing}
          load={async () => (await client.fetchQuery(queries.album(album.id))).tracks}
        />
      }
    />
  );
}

export function ArtistCard({ artist, bare = false }: { artist: Artist; bare?: boolean }) {
  const t = useT();
  const client = useQueryClient();
  const prefetch = () => void client.prefetchQuery(queries.artist(artist.id));

  return (
    <Card
      href={`/artists/${artist.id}`}
      prefetch={prefetch}
      round
      bare={bare}
      title={artist.name}
      subtitle={
        t("count.tracks", { count: artist.trackCount }) +
        (artist.albumCount > 0 ? `, ${t("count.albums", { count: artist.albumCount })}` : "")
      }
      cover={<ArtistCover artist={artist} />}
      toneSrc={artistImageUrl({ artistId: artist.id, hasImage: artist.hasImage, variant: "thumb" })}
    />
  );
}

export function PlaylistCard({ playlist, showOwner }: { playlist: Playlist; showOwner?: boolean }) {
  const t = useT();
  const format = useFormat();
  const client = useQueryClient();
  const prefetch = () => void client.prefetchQuery(queries.playlist(playlist.id));

  const tail = showOwner
    ? ` · ${t("playlists.by", { name: playlist.ownerName })}`
    : playlist.durationSeconds > 0
      ? ` · ${format.totalDuration(playlist.durationSeconds)}`
      : "";

  return (
    <Card
      href={`/playlists/${playlist.id}`}
      prefetch={prefetch}
      title={playlist.name}
      subtitle={t("count.tracks", { count: playlist.trackCount }) + tail}
      cover={<PlaylistCover playlist={playlist} fallback={<ListMusicIcon size={34} />} />}
      toneSrc={playlistCoverUrl({
        playlistId: playlist.id,
        hasCover: playlist.hasCover,
        coverTrackId: playlist.coverTrackId,
        variant: "thumb",
      })}
      action={
        <CardPlayButton
          name={playlist.name}
          playing={false}
          load={async () => (await client.fetchQuery(queries.playlist(playlist.id))).tracks}
        />
      }
    />
  );
}

export function CardPlayButton({
  name,
  playing,
  load,
  size,
  className = "right-2.5 bottom-2.5",
}: {
  name: string;
  playing: boolean;
  load: () => Promise<Track[]>;
  size?: 8 | 9;
  className?: string;
}) {
  const t = useT();
  const { playSet } = usePlayback();
  const play = useMutation({ mutationFn: load, onSuccess: (tracks) => playSet(tracks) });

  return (
    <button
      type="button"
      onClick={() => play.mutate()}
      disabled={play.isPending}
      aria-label={playing ? t("action.pause") : t("action.playNamed", { name })}
      aria-busy={play.isPending}
      className={cn("pointer-events-auto absolute rounded-full", className)}
    >
      <PlayBadge size={size} playing={playing} visible={playing || play.isPending} standalone />
      {play.isPending && <BufferingRing />}
    </button>
  );
}

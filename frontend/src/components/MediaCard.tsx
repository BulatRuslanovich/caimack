// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { queries } from "@/lib/queries";
import type { Album, Artist, LibraryItem, Playlist, Track } from "@/lib/types";
import { usePlayback } from "@/lib/playback/usePlayback";
import { useNowPlaying } from "@/contexts/PlayerContext";
import { useFormat } from "@/lib/useFormat";
import { artistImageUrl, coverUrl, playlistCoverUrl } from "@/lib/media";
import { useTone } from "@/lib/useCoverTone";
import { useT } from "@/contexts/I18nContext";
import { AlbumCover, ArtistCover, Cover, PlaylistCover } from "./Cover";
import { ListMusicIcon } from "lucide-react";
import { BufferingRing } from "./PlaybackIndicators";
import { LibraryItemMenu } from "./LibrarySaveButton";
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
  menu,
  toneSrc,
  layout = "grid",
  details,
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
  menu?: ReactNode;
  toneSrc?: string | null | (string | null)[];
  layout?: "grid" | "list";
  details?: ReactNode;
}) {
  const tone = useTone<HTMLElement>(toneSrc);
  const list = layout === "list";

  const caption = (
    <>
      <span
        title={title}
        className={cn(
          "line-clamp-2 text-sm leading-snug font-medium",
          current && "text-primary",
          !list && menu && "pr-10",
        )}
      >
        {title}
      </span>
      <span
        className={cn(
          "library-secondary line-clamp-2 text-sm leading-snug",
          !list && menu && "pr-10",
        )}
      >
        {subtitle}
      </span>
      {details && (
        <span
          className={cn(
            "library-tertiary line-clamp-2 text-xs leading-snug",
            !list && menu && "pr-10",
          )}
        >
          {details}
        </span>
      )}
    </>
  );
  const body = (
    <>
      <div
        className={cn(
          "card-art relative overflow-hidden rounded-xs bg-accent",
          list ? "size-14 shrink-0" : "mb-3.5 aspect-square w-full",
          round && "rounded-full",
        )}
      >
        {cover}
      </div>
      {list ? <span className="flex min-w-0 flex-1 flex-col gap-1">{caption}</span> : caption}
    </>
  );

  const shell = cn(
    "flex min-w-0 text-left hover:no-underline",
    list ? "items-center gap-3" : "flex-col gap-1",
    bare && !list && "items-center text-center",
    active && "[&>div:first-child]:ring-2 [&>div:first-child]:ring-primary",
  );

  if (!href && !menu && !action && !list) {
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

  return (
    <div
      {...tone}
      data-round={round}
      className={cn(
        "media-card group relative flex min-w-0",
        list ? "items-center gap-2 rounded-md p-2 hover:bg-raised" : "flex-col",
      )}
    >
      {href ? (
        <Link
          href={href}
          prefetch={false}
          className={cn(shell, "flex-1")}
          onMouseEnter={prefetch}
          onFocus={prefetch}
        >
          {body}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active || undefined}
          className={cn(shell, "flex-1")}
        >
          {body}
        </button>
      )}

      {menu && <div className={list ? "shrink-0" : "absolute right-0 bottom-0"}>{menu}</div>}
      {action && !list && (
        <div className="card-art-overlay pointer-events-none absolute inset-x-0 top-0 aspect-square">
          {action}
        </div>
      )}
    </div>
  );
}

export function SavedLibraryCard({ item, layout }: { item: LibraryItem; layout: "grid" | "list" }) {
  const t = useT();
  const format = useFormat();
  const client = useQueryClient();
  const kind = t(
    item.kind === "album"
      ? "albums.kind"
      : item.kind === "artist"
        ? "artists.kind"
        : "playlists.kind",
  );
  const duration = item.durationSeconds ?? 0;
  const details = [
    item.trackCount != null ? t("count.tracks", { count: item.trackCount }) : null,
    item.kind === "artist" && item.albumCount != null
      ? t("count.albums", { count: item.albumCount })
      : null,
    item.kind !== "artist" && duration > 0 ? format.totalDuration(duration) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const prefetch = () => {
    if (item.kind === "album") void client.prefetchQuery(queries.album(item.id));
    else if (item.kind === "artist") void client.prefetchQuery(queries.artist(item.id));
    else void client.prefetchQuery(queries.playlist(item.id));
  };
  return (
    <Card
      layout={layout}
      href={`/${item.kind}s/${item.id}`}
      prefetch={prefetch}
      title={item.title}
      subtitle={[kind, item.subtitle, item.year].filter(Boolean).join(" · ")}
      details={details}
      round={item.kind === "artist"}
      cover={
        <Cover
          name={item.title}
          hasCover={item.hasImage}
          rounded={item.kind === "artist"}
          albumId={item.kind === "album" ? item.id : undefined}
          artistId={item.kind === "artist" ? item.id : undefined}
          playlistId={item.kind === "playlist" ? item.id : undefined}
          coverTrackId={item.coverTrackId}
        />
      }
      menu={<LibraryItemMenu kind={item.kind} id={item.id} title={item.title} />}
    />
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
      menu={<LibraryItemMenu kind="album" id={album.id} title={album.title} />}
      subtitle={album.year ? `${album.artistName}, ${album.year}` : album.artistName}
      cover={<AlbumCover album={album} />}
      toneSrc={coverUrl({ albumId: album.id, hasCover: album.hasCover, variant: "thumb" })}
      action={
        <>
          <CardPlayButton
            name={album.title}
            playing={playing}
            load={async () => (await client.fetchQuery(queries.album(album.id))).tracks}
          />
        </>
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
      menu={<LibraryItemMenu kind="artist" id={artist.id} title={artist.name} />}
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
      menu={<LibraryItemMenu kind="playlist" id={playlist.id} title={playlist.name} />}
      subtitle={t("count.tracks", { count: playlist.trackCount }) + tail}
      cover={<PlaylistCover playlist={playlist} fallback={<ListMusicIcon size={34} />} />}
      toneSrc={playlistCoverUrl({
        playlistId: playlist.id,
        hasCover: playlist.hasCover,
        coverTrackId: playlist.coverTrackId,
        variant: "thumb",
      })}
      action={
        <>
          <CardPlayButton
            name={playlist.name}
            playing={false}
            load={async () => (await client.fetchQuery(queries.playlist(playlist.id))).tracks}
          />
        </>
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

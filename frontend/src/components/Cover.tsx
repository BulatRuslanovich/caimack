// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { CSSProperties, ReactNode, useCallback, useState } from "react";
import { cn } from "@/lib/cn";
import {
  artistImageSrcSet,
  artistImageUrl,
  coverSrcSet,
  coverUrl,
  playlistCoverSrcSet,
  playlistCoverUrl,
  type CoverVariant,
} from "@/lib/media";
import { initialsFor } from "@/lib/format";
import type { Track } from "@/lib/types";
import { useT } from "@/contexts/I18nContext";

interface CoverProps {
  albumId?: string | null;
  trackId?: string | null;
  artistId?: string | null;
  playlistId?: string | null;
  coverTrackId?: string | null;
  hasCover?: boolean;
  name: string;
  size?: number | string;
  variant?: CoverVariant;
  sizes?: string;
  rounded?: boolean;
  className?: string;
  fallback?: ReactNode;
  preview?: string | null;
}

export function Cover({
  albumId,
  trackId,
  artistId,
  playlistId,
  coverTrackId,
  hasCover = true,
  name,
  size = "100%",
  variant = "thumb",
  sizes,
  rounded = false,
  className = "",
  fallback,
  preview,
}: CoverProps) {
  const [failed, setFailed] = useState(false);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const t = useT();

  const source = artistId
    ? artistImageUrl({ artistId, hasImage: hasCover, variant })
    : playlistId
      ? playlistCoverUrl({ playlistId, hasCover, coverTrackId, variant })
      : coverUrl({ albumId, trackId, hasCover, variant });
  const showImage = source !== null && !failed;

  const srcSet = !sizes
    ? null
    : artistId
      ? artistImageSrcSet({ artistId, hasImage: hasCover })
      : playlistId
        ? playlistCoverSrcSet({ playlistId, hasCover, coverTrackId })
        : coverSrcSet({ albumId, trackId, hasCover });

  const loaded = source !== null && loadedSource === source;

  const attach = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete) setLoadedSource(image.getAttribute("src"));
  }, []);

  const style = {
    width: typeof size === "number" ? `${size}px` : size,
    height: typeof size === "number" ? `${size}px` : size,
  };

  return (
    <div
      style={style}
      data-placeholder={showImage ? undefined : "true"}
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden bg-accent [container-type:inline-size]",
        typeof size === "number" && "rounded-xs",
        rounded && "rounded-full",
        className,
      )}
    >
      {showImage ? (
        <>
          {preview && preview !== source && (
            <img
              src={preview}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 size-full object-cover"
            />
          )}
          <img
            ref={attach}
            src={source!}
            srcSet={srcSet ?? undefined}
            sizes={srcSet ? sizes : undefined}
            alt={t("cover.alt", { name })}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoadedSource(source)}
            onError={() => setFailed(true)}
            className={cn(
              "relative size-full object-cover",
              "[transition:opacity_300ms_var(--ease),scale_150ms_var(--ease)]",
              loaded ? "opacity-100" : "opacity-0",
            )}
          />
        </>
      ) : fallback || rounded ? (
        <span
          aria-hidden="true"
          className="grid size-full place-items-center text-[clamp(0.72rem,22cqw,3.25rem)] leading-none font-medium text-faint [&_svg]:size-[38%] [&_svg]:max-h-18 [&_svg]:max-w-18"
        >
          {fallback ?? initialsFor(name)}
        </span>
      ) : (
        <BlankSleeve name={name} />
      )}
    </div>
  );
}

const SLEEVE_TONES = 6;

function BlankSleeve({ name }: { name: string }) {
  const letter = name.match(/[\p{L}\p{N}]/u)?.[0].toUpperCase();
  const tone =
    [...name.trim().toLowerCase()].reduce(
      (hash, char) => (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0,
      0,
    ) % SLEEVE_TONES;

  return (
    <span
      aria-hidden="true"
      style={{ "--sleeve": `var(--sleeve-${tone})` } as CSSProperties}
      className="grid size-full place-items-center bg-(--sleeve)"
    >
      <span className="grid size-[64%] place-items-center rounded-full border border-border">
        <span className="grid size-[56%] place-items-center rounded-full bg-[color-mix(in_oklab,var(--sleeve),var(--foreground)_18%)]">
          {letter && (
            <span className="hidden font-display text-[16cqw] leading-none text-(--sleeve) @min-[5rem]:block">
              {letter}
            </span>
          )}
          <span
            className={cn("size-[22%] rounded-full bg-(--sleeve)", letter && "@min-[5rem]:hidden")}
          />
        </span>
      </span>
    </span>
  );
}

type CoverLook = Omit<
  CoverProps,
  "albumId" | "trackId" | "artistId" | "playlistId" | "coverTrackId" | "hasCover" | "name"
>;

export function TrackCover({
  track,
  ...look
}: {
  track: Pick<Track, "id" | "title" | "albumId" | "albumTitle" | "hasCover">;
} & CoverLook) {
  return (
    <Cover
      albumId={track.albumId}
      trackId={track.id}
      hasCover={track.hasCover}
      name={track.albumTitle ?? track.title}
      {...look}
    />
  );
}

export function AlbumCover({
  album,
  ...look
}: {
  album: { id: string; title: string; hasCover: boolean };
} & CoverLook) {
  return <Cover albumId={album.id} hasCover={album.hasCover} name={album.title} {...look} />;
}

export function ArtistCover({
  artist,
  ...look
}: {
  artist: { id: string; name: string; hasImage: boolean };
} & CoverLook) {
  return (
    <Cover artistId={artist.id} hasCover={artist.hasImage} name={artist.name} rounded {...look} />
  );
}

export function PlaylistCover({
  playlist,
  ...look
}: {
  playlist: { id: string; name: string; hasCover: boolean; coverTrackId?: string | null };
} & CoverLook) {
  return (
    <Cover
      playlistId={playlist.id}
      hasCover={playlist.hasCover}
      coverTrackId={playlist.coverTrackId}
      name={playlist.name}
      {...look}
    />
  );
}

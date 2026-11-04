// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { API_BASE } from "@/lib/http";
import type { AudioQuality, Track } from "@/lib/types";

export type CoverVariant = "thumb" | "full" | "large";

const COVER_EDGES: Record<CoverVariant, number> = {
  thumb: 256,
  full: 640,
  large: 1024,
};

function sizeQuery(variant: CoverVariant): string {
  return variant === "full" ? "" : `?size=${variant}`;
}

export const mediaUrl = {
  stream: (trackId: string) => `${API_BASE}/tracks/${trackId}/stream`,
  hls: (trackId: string, maxQuality: Exclude<AudioQuality, "Original">) =>
    `${API_BASE}/tracks/${trackId}/hls/master.m3u8?maxQuality=${maxQuality}`,
  trackCover: (trackId: string, variant: CoverVariant = "full") =>
    `${API_BASE}/tracks/${trackId}/cover${sizeQuery(variant)}`,
  albumCover: (albumId: string, variant: CoverVariant = "full") =>
    `${API_BASE}/albums/${albumId}/cover${sizeQuery(variant)}`,
  artistImage: (artistId: string, variant: CoverVariant = "full") =>
    `${API_BASE}/artists/${artistId}/image${sizeQuery(variant)}`,
  playlistCover: (playlistId: string, variant: CoverVariant = "full") =>
    `${API_BASE}/playlists/${playlistId}/cover${sizeQuery(variant)}`,
};

const imageVersions = new Map<string, number>();

function versioned(url: string, key: string): string {
  const version = imageVersions.get(key);
  return version === undefined ? url : `${url}${url.includes("?") ? "&" : "?"}v=${version}`;
}

export function markImageChanged(
  kind: "album" | "artist" | "playlist",
  id: string,
  changed: boolean,
) {
  if (changed) imageVersions.set(`${kind}:${id}`, Date.now());
  else imageVersions.delete(`${kind}:${id}`);
}

export function artistImageUrl({
  artistId,
  hasImage = true,
  variant = "full",
}: {
  artistId?: string | null;
  hasImage?: boolean;
  variant?: CoverVariant;
}): string | null {
  if (!hasImage || !artistId) return null;

  return versioned(mediaUrl.artistImage(artistId, variant), `artist:${artistId}`);
}

export function playlistCoverUrl({
  playlistId,
  hasCover = false,
  coverTrackId,
  variant = "full",
}: {
  playlistId?: string | null;
  hasCover?: boolean;
  coverTrackId?: string | null;
  variant?: CoverVariant;
}): string | null {
  if (hasCover && playlistId) {
    return versioned(mediaUrl.playlistCover(playlistId, variant), `playlist:${playlistId}`);
  }

  if (coverTrackId) return mediaUrl.trackCover(coverTrackId, variant);

  return null;
}

export function coverUrl({
  albumId,
  trackId,
  hasCover = true,
  variant = "full",
}: {
  albumId?: string | null;
  trackId?: string | null;
  hasCover?: boolean;
  variant?: CoverVariant;
}): string | null {
  if (!hasCover) return null;
  if (albumId) return versioned(mediaUrl.albumCover(albumId, variant), `album:${albumId}`);
  if (trackId) return mediaUrl.trackCover(trackId, variant);
  return null;
}

export function trackCoverUrl(
  track: Pick<Track, "albumId" | "id" | "hasCover">,
  variant: CoverVariant = "full",
): string | null {
  return coverUrl({ albumId: track.albumId, trackId: track.id, hasCover: track.hasCover, variant });
}

export function coverSrcSet(options: {
  albumId?: string | null;
  trackId?: string | null;
  hasCover?: boolean;
}): string | null {
  return srcSetOf((variant) => coverUrl({ ...options, variant }));
}

export function artistImageSrcSet(options: {
  artistId?: string | null;
  hasImage?: boolean;
}): string | null {
  return srcSetOf((variant) => artistImageUrl({ ...options, variant }));
}

export function playlistCoverSrcSet(options: {
  playlistId?: string | null;
  hasCover?: boolean;
  coverTrackId?: string | null;
}): string | null {
  return srcSetOf((variant) => playlistCoverUrl({ ...options, variant }));
}

function srcSetOf(urlFor: (variant: CoverVariant) => string | null): string | null {
  const entries = (["thumb", "full", "large"] as const)
    .map((variant) => {
      const url = urlFor(variant);
      return url === null ? null : `${url} ${COVER_EDGES[variant]}w`;
    })
    .filter((entry) => entry !== null);

  return entries.length > 0 ? entries.join(", ") : null;
}

// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { ListMusicIcon } from "lucide-react";
import { Cover, type CoverLook } from "@/components/Cover";
import type { CoverTrack, Playlist } from "@/lib/types";
import { BadgedCover } from "./BadgedCover";
import { CoverMosaic } from "./CoverMosaic";

function uniqueCoverTracks(tracks: CoverTrack[]) {
  const seen = new Set<string>();
  const selected: CoverTrack[] = [];
  for (const track of tracks) {
    const key = track.albumId ?? track.id;
    if (!track.hasCover || seen.has(key)) continue;
    seen.add(key);
    selected.push(track);
    if (selected.length === 4) break;
  }
  return selected;
}

export function PlaylistCover({
  playlist,
  fallback,
  sizes,
  variant,
}: {
  playlist: Pick<Playlist, "id" | "name" | "hasCover" | "coverTrackId" | "coverTracks">;
} & Pick<CoverLook, "fallback" | "sizes" | "variant">) {
  const tracks =
    !playlist.hasCover && playlist.coverTracks !== undefined
      ? uniqueCoverTracks(playlist.coverTracks)
      : undefined;
  const hasArtwork = tracks
    ? tracks.length > 0
    : Boolean(playlist.hasCover || playlist.coverTrackId);

  return (
    <BadgedCover icon={ListMusicIcon} hasArtwork={hasArtwork}>
      {tracks ? (
        <CoverMosaic tracks={tracks} layout="fit" />
      ) : (
        <Cover
          playlistId={playlist.id}
          hasCover={playlist.hasCover}
          coverTrackId={playlist.coverTrackId}
          name={playlist.name}
          fallback={hasArtwork ? fallback : undefined}
          sizes={sizes}
          variant={variant}
        />
      )}
    </BadgedCover>
  );
}

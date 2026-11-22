// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { FolderIcon } from "lucide-react";
import type { ReactElement } from "react";
import { Cover, TrackCover } from "@/components/Cover";
import { orderedKeys } from "@/lib/libraryOrder";
import type { LibraryItem } from "@/lib/types";
import { BadgedCover } from "./BadgedCover";
import { Mosaic } from "./CoverMosaic";

export function FolderCover({ items, order }: { items: LibraryItem[]; order?: string[] }) {
  const byKey = new Map(items.map((item) => [`${item.kind}:${item.id}`, item]));
  const tiles: ReactElement[] = [];

  for (const key of orderedKeys([...byKey.keys()], order)) {
    const item = byKey.get(key)!;
    const playlistId = item.kind === "playlist" ? item.id : undefined;
    const track = playlistId && !item.hasImage && item.coverTracks?.find((track) => track.hasCover);
    if (!item.hasImage && !track && !(playlistId && item.coverTrackId)) continue;

    tiles.push(
      track ? (
        <TrackCover key={key} track={track} />
      ) : (
        <Cover
          key={key}
          name={item.title}
          hasCover={item.hasImage}
          albumId={item.kind === "album" ? item.id : undefined}
          artistId={item.kind === "artist" ? item.id : undefined}
          playlistId={playlistId}
          coverTrackId={item.coverTrackId}
        />
      ),
    );
    if (tiles.length === 4) break;
  }

  return (
    <BadgedCover icon={FolderIcon} hasArtwork={tiles.length > 0}>
      <Mosaic tiles={tiles} layout="repeat" />
    </BadgedCover>
  );
}

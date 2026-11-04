// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { ReactNode } from "react";
import type { Track } from "@/lib/types";
import { trackCoverUrl } from "@/lib/media";
import { Cover, TrackCover } from "@/components/Cover";

function Mosaic({ tiles, empty }: { tiles: ReactNode[]; empty?: ReactNode }) {
  if (tiles.length === 0) {
    return (
      <div className="grid size-full place-items-center bg-raised text-faint [&_svg]:size-1/3">
        {empty}
      </div>
    );
  }

  if (tiles.length < 4) return <div className="size-full">{tiles[0]}</div>;

  return <div className="grid size-full grid-cols-2 grid-rows-2">{tiles.slice(0, 4)}</div>;
}

export function mosaicBackdrop(tracks: Track[]): string | null {
  const lead = tracks.find((track) => track.hasCover);
  return lead ? trackCoverUrl(lead, "thumb") : null;
}

export function CoverMosaic({ tracks, empty }: { tracks: Track[]; empty?: ReactNode }) {
  return (
    <Mosaic
      empty={empty}
      tiles={tracks.slice(0, 4).map((track) => (
        <TrackCover key={track.id} track={track} />
      ))}
    />
  );
}

export function AlbumMosaic({ albumIds, name }: { albumIds: string[]; name: string }) {
  const tiles =
    albumIds.length === 0
      ? [<Cover key="none" hasCover={false} name={name} />]
      : albumIds.slice(0, 4).map((id) => <Cover key={id} albumId={id} name={name} />);

  return <Mosaic tiles={tiles} />;
}

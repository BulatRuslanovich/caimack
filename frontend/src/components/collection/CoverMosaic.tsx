// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { cloneElement, type ReactElement, type ReactNode } from "react";
import type { CoverTrack } from "@/lib/types";
import { trackCoverUrl } from "@/lib/media";
import { Cover, TrackCover } from "@/components/Cover";
import { cn } from "@/lib/cn";

export function Mosaic({
  tiles,
  empty,
  layout,
}: {
  tiles: ReactElement[];
  empty?: ReactNode;
  layout?: "repeat" | "fit";
}) {
  if (tiles.length === 0) {
    return (
      <div className="grid size-full place-items-center bg-raised text-faint [&_svg]:size-1/3">
        {empty}
      </div>
    );
  }

  if (tiles.length === 1 || (!layout && tiles.length < 4)) {
    return <div className="size-full">{tiles[0]}</div>;
  }

  const cells = tiles.slice(0, 4);
  if (layout === "repeat") {
    for (let index = 0; cells.length < 4; index++) {
      cells.push(cloneElement(tiles[index], { key: `repeat-${index}` }));
    }
  }

  return (
    <div
      className={cn(
        "grid size-full grid-cols-2",
        cells.length === 2 ? "grid-rows-1" : "grid-rows-2",
        cells.length === 3 && "[&>:first-child]:row-span-2",
      )}
    >
      {cells}
    </div>
  );
}

export function mosaicBackdrop(tracks: CoverTrack[]): string | null {
  const lead = tracks.find((track) => track.hasCover);
  return lead ? trackCoverUrl(lead, "thumb") : null;
}

export function CoverMosaic({
  tracks,
  empty,
  layout,
}: {
  tracks: CoverTrack[];
  empty?: ReactNode;
  layout?: "fit";
}) {
  return (
    <Mosaic
      empty={empty}
      layout={layout}
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

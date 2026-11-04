// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { CoverMosaic } from "@/components/collection/CoverMosaic";
import { PlayAllButton } from "@/components/PlayAllButton";
import type { Track } from "@/lib/types";

export function MixCover({ tracks, title }: { tracks: Track[]; title: string }) {
  const covers = tracks
    .filter((track) => track.hasCover)
    .filter(
      (track, index, covered) =>
        covered.findIndex(
          (other) => (other.albumId ?? other.id) === (track.albumId ?? track.id),
        ) === index,
    );

  return (
    <div className="relative aspect-square w-full self-start overflow-hidden rounded-sm shadow-art">
      <CoverMosaic tracks={covers.length >= 4 ? covers : tracks} />
      <div className="absolute right-3 bottom-3">
        <PlayAllButton tracks={tracks} name={title} />
      </div>
    </div>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { cn } from "@/lib/cn";
import { NowPlayingBars } from "./PlaybackIndicators";

export const playbackListClass = "library-track-list flex flex-col";
export const playbackHeaderClass = "library-track-list-header rounded-none border-b pb-2";
export const playbackGridClass =
  "grid items-center gap-3 rounded-md px-2.5 py-2 max-md:gap-2 max-md:px-1";
export const playbackNumberClass = "flex items-center gap-1 text-sm text-faint tabular-nums";
export const playbackTitleClass = "truncate text-body font-semibold";
export const playbackDurationClass = "text-right text-sm text-muted-foreground tabular-nums";

export function playbackRowClass(current: boolean) {
  return cn(
    "library-track-row group relative transition-colors",
    "hover:bg-card focus-within:bg-card focus-visible:bg-card focus-visible:-outline-offset-2",
    current && "track-row-current bg-card",
  );
}

export function PlaybackRowNumber({
  number,
  current,
  playing,
  className,
}: {
  number: number;
  current: boolean;
  playing: boolean;
  className?: string;
}) {
  const visibility = cn("group-hover:hidden [@media(hover:none)]:hidden", className);
  return playing ? (
    <NowPlayingBars className={cn("text-primary", visibility)} />
  ) : (
    <span className={cn(visibility, current && "text-primary")}>{number}</span>
  );
}

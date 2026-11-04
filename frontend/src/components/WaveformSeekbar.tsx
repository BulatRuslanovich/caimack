// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useQuery } from "@tanstack/react-query";
import { memo, type ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { queries } from "@/lib/queries";
import type { TrackCues } from "@/lib/types";
import { Seekbar } from "./Seekbar";

const BAR_GAP = 0.35;
const MIN_BAR = 0.06;

interface Marks {
  cues?: TrackCues | null;
  transition?: { at: number; label: string } | null;
}

export function WaveformSeekbar({
  trackId,
  cues,
  transition,
  className,
  ...seekbar
}: ComponentProps<typeof Seekbar> & Marks & { trackId: string }) {
  const { data: peaks } = useQuery(queries.waveform(trackId));

  if (!peaks || peaks.length === 0) return <Seekbar {...seekbar} className={className} />;

  const total = seekbar.max > 0 ? seekbar.max : 0;
  const percent = total > 0 ? Math.min(100, (seekbar.value / total) * 100) : 0;
  const share = (seconds: number) =>
    total > 0 ? Math.min(100, Math.max(0, (seconds / total) * 100)) : 0;

  return (
    <div
      className={cn("wave-seek relative h-12", className)}
      style={{ ["--wave-progress" as string]: `${percent}%` }}
    >
      {cues && cues.outroStart < cues.audioEnd - 1 && (
        <span
          aria-hidden="true"
          className="wave-outro"
          style={{
            left: `${share(cues.outroStart)}%`,
            width: `${share(cues.audioEnd) - share(cues.outroStart)}%`,
          }}
        />
      )}

      <Bars
        peaks={peaks}
        className="wave-bars text-[color-mix(in_oklab,var(--foreground)_28%,transparent)]"
      />
      <Bars peaks={peaks} className="wave-bars wave-played text-foreground" />

      {transition && total > 0 && transition.at < total && (
        <span
          className="wave-mark"
          style={{ left: `${share(transition.at)}%` }}
          title={transition.label}
          aria-hidden="true"
        />
      )}

      <Seekbar {...seekbar} className="absolute inset-0 h-full" />
    </div>
  );
}

const Bars = memo(function Bars({ peaks, className }: { peaks: number[]; className: string }) {
  const width = peaks.length;

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} 100`}
      preserveAspectRatio="none"
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
    >
      <path
        fill="currentColor"
        d={peaks
          .map((peak, index) => {
            const height = Math.max(MIN_BAR, peak / 255) * 100;
            const top = (100 - height) / 2;
            return `M${index + BAR_GAP / 2} ${top}h${1 - BAR_GAP}v${height}h-${1 - BAR_GAP}z`;
          })
          .join("")}
      />
    </svg>
  );
});

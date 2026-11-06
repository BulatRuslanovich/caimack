// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useRecommendations } from "@/lib/useRecommendations";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { monthName } from "@/lib/recap";
import { queries } from "@/lib/queries";
import { useFormat } from "@/lib/useFormat";
import { useI18n } from "@/contexts/I18nContext";
import { TrackCover } from "@/components/Cover";

function EnabledRecapBanner() {
  const { locale, t } = useI18n();
  const format = useFormat();
  const recap = useQuery(queries.recap());

  if (!recap.data) return null;

  const { year, month, listenedSeconds, topTracks } = recap.data;
  const covers = topTracks
    .map((item) => item.track)
    .filter((track) => track.hasCover)
    .slice(0, 3);

  return (
    <Link
      href="/recap"
      className="group flex items-center gap-5 overflow-hidden rounded-lg border border-border bg-card p-5 text-foreground transition-colors duration-150 ease-brand hover:bg-raised hover:no-underline focus-visible:outline-2 focus-visible:outline-ring max-sm:gap-3 max-sm:p-4"
    >
      {covers.length > 0 && (
        <span className="flex shrink-0 -space-x-6">
          {covers.map((track, position) => (
            <span
              key={track.id}
              className="size-16 overflow-hidden rounded-xs shadow-art max-sm:size-10"
              style={{ transform: `rotate(${(position - (covers.length - 1) / 2) * 7}deg)` }}
            >
              <TrackCover track={track} />
            </span>
          ))}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-display text-xl font-semibold max-sm:line-clamp-2 max-sm:whitespace-normal max-sm:text-base">
          {t("recap.banner", { month: monthName(year, month, locale) })}
        </span>
        <span className="truncate text-sm text-muted-foreground">
          {t("recap.bannerNote", { duration: format.totalDuration(listenedSeconds) })}
        </span>
      </span>
      <ChevronRightIcon className="size-5 shrink-0 text-primary transition-transform duration-150 ease-brand group-hover:translate-x-0.5" />
    </Link>
  );
}

export function RecapBanner() {
  const enabled = useRecommendations();
  return enabled ? <EnabledRecapBanner /> : null;
}

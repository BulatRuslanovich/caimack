// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";
import { Cover } from "@/components/Cover";
import { Button } from "@/components/ui/button";
import { useT } from "@/contexts/I18nContext";
import { genreName } from "@/lib/format";
import type { Spot } from "@/lib/libraryMap";
import type { MapPoint } from "@/lib/types";
import { PlayIcon, RadioIcon, XIcon } from "lucide-react";

export const CARD_WIDTH_PX = 290;
export interface MapCard {
  point: MapPoint;
  at: Spot;
  flip: boolean;
}

export function MapTrackCard({
  card,
  picked,
  onPlay,
  onRadio,
  onClose,
}: {
  card: MapCard;
  picked: boolean;
  onPlay: (point: MapPoint) => void;
  onRadio: (point: MapPoint) => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <>
      {
        <div
          className={`map-track-card absolute z-10 flex max-w-[17rem] items-center gap-3 rounded-xl bg-popover/95 p-3 text-popover-foreground shadow-pop ${
            picked ? "" : "pointer-events-none"
          }`}
          style={{
            left: `clamp(1rem, ${card.at.x + (card.flip ? -CARD_WIDTH_PX : 14)}px, calc(100% - var(--map-card-width) - 1rem))`,
            top: `clamp(1rem, ${card.at.y - 28}px, calc(100% - 9rem))`,
          }}
          role={picked ? "dialog" : undefined}
          aria-label={picked ? card.point.title : undefined}
        >
          <Cover
            albumId={card.point.albumId}
            trackId={card.point.id}
            hasCover={card.point.hasCover}
            name={card.point.title}
            size={picked ? "3rem" : "2.5rem"}
            className="shrink-0 rounded-sm"
          />

          <div className="flex min-w-0 flex-1 flex-col">
            <span className={`${picked ? "line-clamp-2" : "truncate"} text-sm font-medium`}>
              {card.point.title}
            </span>
            <span className="truncate text-xs text-muted-foreground">{card.point.artist}</span>
            <span className="truncate text-xs text-faint">
              {[
                card.point.genre && genreName(card.point.genre),
                card.point.plays > 0
                  ? t("map.plays", { count: card.point.plays })
                  : t("map.neverPlayed"),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>

          {picked && (
            <div className="flex shrink-0 flex-col gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onPlay(card.point)}
                aria-label={t("action.playNamed", { name: card.point.title })}
              >
                <PlayIcon size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onRadio(card.point)}
                aria-label={t("map.radioFrom")}
                title={t("map.radioFrom")}
              >
                <RadioIcon size={14} />
              </Button>
            </div>
          )}

          {picked && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute -top-2 -right-2 size-6 bg-popover shadow-pop"
              onClick={() => onClose()}
              aria-label={t("action.close")}
            >
              <XIcon size={12} />
            </Button>
          )}
        </div>
      }
    </>
  );
}

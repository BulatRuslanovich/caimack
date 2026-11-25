// SPDX-License-Identifier: AGPL-3.0-only

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

function TrackStats({ point }: { point: MapPoint }) {
  const t = useT();
  return (
    <span className="block truncate text-xs text-faint">
      {[
        point.genre && genreName(point.genre),
        point.plays > 0 ? t("map.plays", { count: point.plays }) : t("map.neverPlayed"),
      ]
        .filter(Boolean)
        .join(" · ")}
    </span>
  );
}

type TrackActions = {
  onPlay: (point: MapPoint) => void;
  onRadio: (point: MapPoint) => void;
  onClose: () => void;
};

export function MapTrackCard({ card }: { card: MapCard }) {
  return (
    <div
      className="map-track-card pointer-events-none absolute z-10 flex items-center gap-3 rounded-xl bg-popover/95 p-3 text-popover-foreground shadow-pop"
      style={{
        left: `clamp(1rem, ${card.at.x + (card.flip ? -CARD_WIDTH_PX : 14)}px, calc(100% - var(--map-card-width) - 1rem))`,
        top: `clamp(1rem, ${card.at.y - 28}px, calc(100% - 9rem))`,
      }}
    >
      <Cover
        albumId={card.point.albumId}
        trackId={card.point.id}
        hasCover={card.point.hasCover}
        name={card.point.title}
        size="2.5rem"
        className="shrink-0 rounded-sm"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{card.point.title}</span>
        <span className="truncate text-xs text-muted-foreground">{card.point.artist}</span>
        <TrackStats point={card.point} />
      </div>
    </div>
  );
}

export function MapTrackPanel({
  point,
  raised,
  onPlay,
  onRadio,
  onClose,
}: TrackActions & { point: MapPoint; raised: boolean }) {
  const t = useT();
  return (
    <section
      className="map-track-panel rounded-xl bg-popover text-popover-foreground shadow-pop"
      data-raised={raised}
      aria-label={point.title}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3">
        <Cover
          albumId={point.albumId}
          trackId={point.id}
          hasCover={point.hasCover}
          name={point.title}
          size="3.5rem"
          className="rounded-md"
        />
        <div className="min-w-0 self-center">
          <h2 className="line-clamp-2 text-base font-semibold">{point.title}</h2>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{point.artist}</p>
          <TrackStats point={point} />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label={t("action.close")}
          title={t("action.close")}
        >
          <XIcon size={15} />
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => onPlay(point)}
          aria-label={t("action.playNamed", { name: point.title })}
        >
          <PlayIcon size={14} />
          {t("action.play")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onRadio(point)}
          aria-label={t("map.radioFrom")}
        >
          <RadioIcon size={14} />
          {t("action.radio")}
        </Button>
      </div>
    </section>
  );
}

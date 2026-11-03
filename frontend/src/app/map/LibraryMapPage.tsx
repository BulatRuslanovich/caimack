// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { genreName } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { MAX_SELECTION_PLAY, closestToCentre, median, soundPath } from "@/lib/libraryMap";
import { moodHue, moodLabel } from "@/lib/moods";
import { queries } from "@/lib/queries";
import { readStored, writeStored } from "@/lib/storage";
import { useToast } from "@/lib/useToast";
import type { MapPoint, Track } from "@/lib/types";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { PageHeader } from "@/components/PageHeader";
import { Query } from "@/components/Query";
import { Button } from "@/components/ui/button";
import { MapLayersMenu } from "@/components/map/MapLayersMenu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LibraryMapCanvas,
  MAP_LAYERS,
  type MapController,
  type MapLayer,
  type MapLabel,
  type MapRoute,
} from "@/components/map/LibraryMapCanvas";
import {
  CrosshairIcon,
  HouseIcon,
  LassoSelectIcon,
  MapIcon,
  MaximizeIcon,
  MinimizeIcon,
  MinusIcon,
  PlayIcon,
  PlusIcon,
  ShuffleIcon,
  XIcon,
} from "lucide-react";

const ALL_GENRES = "*";
const GENRE_CHOICES = 16;
const ROUTE_AHEAD = 6;
const ROUTE_BEHIND = 3;
const LAYERS_KEY = "music-streaming.map-layers";

const layerListeners = new Set<() => void>();

function useMapLayers(): [ReadonlySet<MapLayer>, (layer: MapLayer) => void] {
  const hidden = useSyncExternalStore(
    (listener) => {
      layerListeners.add(listener);
      return () => layerListeners.delete(listener);
    },
    () => readStored(LAYERS_KEY) ?? "",
    () => "",
  );

  const layers = useMemo(() => {
    const off = new Set(hidden.split(","));
    return new Set(MAP_LAYERS.filter((layer) => !off.has(layer)));
  }, [hidden]);

  const toggle = (layer: MapLayer) => {
    const off = MAP_LAYERS.filter((each) => (each === layer) === layers.has(each));
    writeStored(LAYERS_KEY, off.join(","));
    for (const listener of layerListeners) listener();
  };

  return [layers, toggle];
}

export function LibraryMapPage() {
  const t = useT();
  const map = useQuery(queries.libraryMap());

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <PageHeader title={t("map.title")} subtitle={t("map.description")} />

      <Query
        result={map}
        isEmpty={(data) => data.points.length === 0}
        empty={{ icon: <MapIcon size={24} />, title: t("map.preparing") }}
      >
        {(data) => (
          <MapExplorer
            points={data.points}
            landmarks={data.landmarks}
            totalTracks={data.totalTracks}
          />
        )}
      </Query>
    </div>
  );
}

function MapExplorer({
  points,
  landmarks,
  totalTracks,
}: {
  points: MapPoint[];
  landmarks: { mood: string; x: number; y: number }[];
  totalTracks: number;
}) {
  const t = useT();
  const { notifyError } = useToast();
  const { currentTrack, currentIndex, queue, nextTrack, shuffle, isPlaying } = usePlayerState();
  const { playQueue, playTrack, startRadio } = usePlayerActions();
  const controller = useRef<MapController>(null);

  const [genre, setGenre] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<MapPoint[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [layers, toggleLayer] = useMapLayers();
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;

    const collapse = () => {
      if (!document.fullscreenElement) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.fullscreenElement) setExpanded(false);
    };

    document.addEventListener("fullscreenchange", collapse);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("fullscreenchange", collapse);
      window.removeEventListener("keydown", escape);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [expanded]);

  const toggleExpanded = () => {
    if (expanded) {
      setExpanded(false);
      return;
    }

    setExpanded(true);
    void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const genres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const point of points) {
      if (point.genre) counts.set(point.genre, (counts.get(point.genre) ?? 0) + 1);
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, GENRE_CHOICES)
      .map(([name]) => name);
  }, [points]);

  const labels = useMemo<MapLabel[]>(() => {
    const moods = landmarks.map((landmark) => ({
      ...landmark,
      text: moodLabel(landmark.mood, t),
      hue: moodHue(landmark.mood),
    }));
    if (!genre) return moods;

    const members = points.filter((point) => point.genre === genre);
    if (members.length === 0) return moods;

    return [
      ...moods,
      {
        text: genreName(genre),
        x: median(members.map((point) => point.x)),
        y: median(members.map((point) => point.y)),
        strong: true,
      },
    ];
  }, [landmarks, genre, points, t]);

  const selectedIds = useMemo(
    () => (selection ? new Set(selection.map((point) => point.id)) : null),
    [selection],
  );

  const path = useMemo(
    () => (selection ? soundPath(closestToCentre(selection, MAX_SELECTION_PLAY)) : null),
    [selection],
  );

  const byId = useMemo(() => new Map(points.map((point) => [point.id, point])), [points]);

  const route = useMemo<MapRoute | null>(() => {
    const at = currentTrack && byId.get(currentTrack.id);
    if (!at) return null;

    const onMap = (tracks: Track[]) => tracks.flatMap((track) => byId.get(track.id) ?? []);
    return {
      at,
      behind: shuffle
        ? []
        : onMap(queue.slice(Math.max(0, currentIndex - ROUTE_BEHIND), currentIndex)),
      ahead: onMap(
        shuffle
          ? nextTrack
            ? [nextTrack]
            : []
          : queue.slice(currentIndex + 1, currentIndex + 1 + ROUTE_AHEAD),
      ),
    };
  }, [byId, currentTrack, currentIndex, queue, nextTrack, shuffle]);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };

  const playOne = (point: MapPoint) =>
    run(async () => {
      const [track] = await api.lookupTracks([point.id]);
      if (track) playTrack(track);
    });

  const radioFrom = (point: MapPoint) =>
    run(async () => {
      const [track] = await api.lookupTracks([point.id]);
      if (track) await startRadio(track);
    });

  const playSelection = (shuffled: boolean) =>
    run(async () => {
      if (!path) return;

      const tracks = await api.lookupTracks(path.map((point) => point.id));
      if (tracks.length === 0) return;

      playQueue(tracks, 0, { shuffle: shuffled });
      setSelection(null);
    });

  return (
    <div
      data-expanded={expanded}
      className={cn(
        "map-explorer flex min-h-0 flex-1 flex-col",
        expanded &&
          "fixed inset-0 z-45 bg-background px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]",
      )}
    >
      <div className="map-toolbar">
        <Select
          value={genre ?? ALL_GENRES}
          onValueChange={(value) => setGenre(value === ALL_GENRES ? null : value)}
        >
          <SelectTrigger aria-label={t("map.genre")} className="min-w-[11rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_GENRES}>{t("map.allGenres")}</SelectItem>
            {genres.map((name) => (
              <SelectItem key={name} value={name}>
                {genreName(name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <MapLayersMenu layers={layers} onToggle={toggleLayer} />

        <Button
          variant={selecting ? "secondary" : "outline"}
          size="sm"
          className="map-selection-toggle"
          aria-pressed={selecting}
          aria-label={t("map.select")}
          title={t("map.select")}
          onClick={() => setSelecting((on) => !on)}
        >
          <LassoSelectIcon size={14} />
          <span>{t("map.select")}</span>
        </Button>

        <div className="map-tools">
          {route && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => controller.current?.locate(route.at.id)}
              aria-label={t("map.locate")}
              title={t("map.locate")}
            >
              <CrosshairIcon size={18} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => controller.current?.zoomBy(1 / 1.5)}
            aria-label={t("map.zoomOut")}
            title={t("map.zoomOut")}
          >
            <MinusIcon size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => controller.current?.zoomBy(1.5)}
            aria-label={t("map.zoomIn")}
            title={t("map.zoomIn")}
          >
            <PlusIcon size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => controller.current?.reset()}
            aria-label={t("map.resetView")}
            title={t("map.resetView")}
          >
            <HouseIcon size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleExpanded}
            aria-pressed={expanded}
            aria-label={expanded ? t("map.exitFullscreen") : t("map.fullscreen")}
            title={expanded ? t("map.exitFullscreen") : t("map.fullscreen")}
          >
            {expanded ? <MinimizeIcon size={18} /> : <MaximizeIcon size={18} />}
          </Button>
        </div>
      </div>

      <div className="map-stage">
        <LibraryMapCanvas
          points={points}
          labels={labels}
          highlightGenre={genre}
          nowPlayingId={currentTrack?.id ?? null}
          playing={isPlaying}
          route={route}
          path={path}
          layers={layers}
          selecting={selecting}
          selectedIds={selectedIds}
          onSelect={(chosen) => {
            setSelection(chosen.length > 0 ? chosen : null);
            setSelecting(false);
          }}
          onPlay={(point) => void playOne(point)}
          onRadio={(point) => void radioFrom(point)}
          controllerRef={controller}
        />

        {selection && (
          <div
            className={cn(
              "map-selection absolute inset-x-3 bottom-3 z-10 mx-auto flex max-w-[34rem] flex-wrap items-center gap-2 rounded-lg bg-popover p-2 pl-4 text-popover-foreground shadow-pop",
            )}
            aria-live="polite"
          >
            <span className="flex-1 text-sm font-medium">
              {t("map.selected", { count: selection.length })}
            </span>
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => void playSelection(false)}
            >
              <PlayIcon size={14} /> {t("action.play")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void playSelection(true)}
            >
              <ShuffleIcon size={14} /> {t("action.shuffle")}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSelection(null)}
              aria-label={t("map.clearSelection")}
              title={t("map.clearSelection")}
            >
              <XIcon size={14} />
            </Button>
          </div>
        )}
      </div>

      <div className="map-footer">
        <span>
          {points.length < totalTracks
            ? t("map.coverage", { count: points.length, total: totalTracks })
            : t("count.tracks", { count: points.length })}
        </span>
        <PlaysLegend />
      </div>
    </div>
  );
}

function PlaysLegend() {
  const t = useT();

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-hidden="true">
      <span>{t("map.legendFew")}</span>
      <span className="h-2 w-28 rounded-full bg-[linear-gradient(to_right,color-mix(in_oklab,var(--faint-foreground)_45%,transparent),color-mix(in_oklab,var(--primary)_30%,transparent),var(--primary))]" />
      <span>{t("map.legendMany")}</span>
    </div>
  );
}

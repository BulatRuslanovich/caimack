// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { genreName } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { MAX_SELECTION_PLAY, closestToCentre, median, soundPath } from "@/lib/libraryMap";
import { defaultMapProjection } from "@/lib/mapProjection";
import { queries } from "@/lib/queries";
import { readStored, writeStored } from "@/lib/storage";
import { useToast } from "@/lib/useToast";
import type { MapPoint, MapProjection, Track } from "@/lib/types";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
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
  type MapSurfaceProps,
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
type GalaxySurface = ComponentType<MapSurfaceProps & { onUnavailable: () => void }>;

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

export function LibraryMapPage({ Galaxy }: { Galaxy?: GalaxySurface }) {
  const t = useT();
  const [mode, setMode] = useState<{ projection: MapProjection; canUse3d: boolean } | null>(
    Galaxy ? null : { projection: "2d", canUse3d: false },
  );
  useEffect(() => {
    if (!Galaxy) return;
    const frame = requestAnimationFrame(() => {
      const projection = defaultMapProjection();
      setMode({ projection, canUse3d: projection === "3d" });
    });
    return () => cancelAnimationFrame(frame);
  }, [Galaxy]);
  const fallback = useCallback(() => setMode({ projection: "2d", canUse3d: false }), []);
  const projection = mode?.projection ?? "2d";
  const map = useQuery({ ...queries.libraryMap(projection), enabled: mode !== null });

  return (
    <div className="map-page flex min-h-0 flex-1 flex-col gap-3">
      {(!mode || !map.data?.points.length) && <MapHeading />}

      <Query
        result={map}
        isEmpty={(data) => data.points.length === 0}
        empty={{
          icon: <MapIcon size={24} />,
          title: t(
            map.data?.totalTracks === 0 && !map.data.updating ? "map.empty" : "map.preparing",
          ),
        }}
      >
        {(data) =>
          mode && (
            <MapExplorer
              key={projection}
              points={data.points}
              totalTracks={data.totalTracks}
              updating={data.updating ?? false}
              projection={projection}
              Galaxy={Galaxy}
              onUnavailable={fallback}
              onSwitchProjection={
                mode.canUse3d
                  ? () => setMode({ projection: projection === "3d" ? "2d" : "3d", canUse3d: true })
                  : undefined
              }
            />
          )
        }
      </Query>
    </div>
  );
}

function MapHeading() {
  const t = useT();

  return <h1 className="map-heading">{t("map.title")}</h1>;
}

function MapExplorer({
  points,
  totalTracks,
  updating,
  projection,
  Galaxy,
  onUnavailable,
  onSwitchProjection,
}: {
  points: MapPoint[];
  totalTracks: number;
  updating: boolean;
  projection: MapProjection;
  Galaxy?: GalaxySurface;
  onUnavailable: () => void;
  onSwitchProjection?: () => void;
}) {
  const t = useT();
  const { notifyError } = useToast();
  const { currentTrack, currentIndex, queue, nextTrack, shuffle, isPlaying } = usePlayerState();
  const { playQueue, playTrack, startRadio, toggleShuffle } = usePlayerActions();
  const controller = useRef<MapController>(null);

  const [genre, setGenre] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectionIds, setSelectionIds] = useState<string[]>([]);
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
    if (!genre) return [];

    const members = points.filter((point) => point.genre === genre);
    if (members.length === 0) return [];

    return [
      {
        text: genreName(genre),
        x: median(members.map((point) => point.x)),
        y: median(members.map((point) => point.y)),
        z: median(members.map((point) => point.z ?? 0.5)),
        strong: true,
      },
    ];
  }, [genre, points]);

  const byId = useMemo(() => new Map(points.map((point) => [point.id, point])), [points]);
  const selection = useMemo(
    () => selectionIds.flatMap((id) => byId.get(id) ?? []),
    [byId, selectionIds],
  );
  const selectedIds = useMemo(
    () => (selection.length ? new Set(selection.map((point) => point.id)) : null),
    [selection],
  );

  const path = useMemo(
    () => (selection.length ? soundPath(closestToCentre(selection, MAX_SELECTION_PLAY)) : null),
    [selection],
  );

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

  const playSelection = () =>
    run(async () => {
      if (!path) return;

      const tracks = await api.lookupTracks(path.map((point) => point.id));
      if (tracks.length === 0) return;

      playQueue(tracks, 0);
      setSelectionIds([]);
    });

  const surface: MapSurfaceProps = {
    points,
    labels,
    highlightGenre: genre,
    nowPlayingId: currentTrack?.id ?? null,
    playing: isPlaying,
    route,
    path,
    layers,
    selecting,
    selectedIds,
    onSelect: (chosen) => {
      setSelectionIds(chosen.map((point) => point.id));
      setSelecting(false);
    },
    onPlay: (point) => void playOne(point),
    onRadio: (point) => void radioFrom(point),
    controllerRef: controller,
  };

  return (
    <div
      data-expanded={expanded}
      className={cn(
        "map-explorer flex min-h-0 flex-1 flex-col",
        expanded && "fixed inset-0 z-45 bg-background",
      )}
    >
      <header className="map-toolbar">
        <MapHeading />
        <p className="sr-only">{t("map.description")}</p>
        <div className="map-filters">
          <Select
            value={genre ?? ALL_GENRES}
            onValueChange={(value) => setGenre(value === ALL_GENRES ? null : value)}
          >
            <SelectTrigger aria-label={t("map.genre")} className="map-genre-trigger">
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

          {onSwitchProjection && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={t(projection === "3d" ? "map.switch2d" : "map.switch3d")}
              title={t(projection === "3d" ? "map.switch2d" : "map.switch3d")}
              onClick={onSwitchProjection}
            >
              {projection.toUpperCase()}
            </Button>
          )}

          <Button
            variant="ghost"
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
        </div>
      </header>

      <div className="map-workspace">
        <div className="map-stage">
          {projection === "3d" && Galaxy ? (
            <Suspense fallback={null}>
              <Galaxy {...surface} onUnavailable={onUnavailable} />
            </Suspense>
          ) : (
            <LibraryMapCanvas {...surface} />
          )}

          {selection.length > 0 && (
            <div
              className="map-selection absolute inset-x-3 bottom-3 z-10 mx-auto flex max-w-[34rem] flex-wrap items-center gap-2 rounded-lg bg-popover p-2 pl-4 text-popover-foreground shadow-pop"
              aria-live="polite"
            >
              <span className="flex-1 text-sm font-medium">
                {t("map.selected", { count: selection.length })}
              </span>
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => void playSelection()}
              >
                <PlayIcon size={14} /> {t("action.play")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={toggleShuffle}
                aria-pressed={shuffle}
                className={cn(
                  shuffle &&
                    "border-primary bg-primary text-primary-foreground hover:border-primary hover:bg-primary/90",
                )}
              >
                <ShuffleIcon size={14} /> {t("action.shuffle")}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSelectionIds([])}
                aria-label={t("map.clearSelection")}
                title={t("map.clearSelection")}
              >
                <XIcon size={14} />
              </Button>
            </div>
          )}
        </div>

        <div className="map-tools">
          {route && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => controller.current?.locate(route.at.id)}
              disabled={projection === "3d" && selecting}
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
            disabled={projection === "3d" && selecting}
            aria-label={t("map.zoomOut")}
            title={t("map.zoomOut")}
          >
            <MinusIcon size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => controller.current?.zoomBy(1.5)}
            disabled={projection === "3d" && selecting}
            aria-label={t("map.zoomIn")}
            title={t("map.zoomIn")}
          >
            <PlusIcon size={18} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => controller.current?.reset()}
            disabled={projection === "3d" && selecting}
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

      <div className="map-footer">
        <span>
          {points.length < totalTracks
            ? t("map.coverage", { count: points.length, total: totalTracks })
            : t("count.tracks", { count: points.length })}
          {updating && <span role="status"> · {t("map.updating")}</span>}
        </span>
        <PlaysLegend />
      </div>
    </div>
  );
}

function PlaysLegend() {
  const t = useT();

  return (
    <div className="map-plays-legend">
      <span>{t("map.legendFew")}</span>
      <span className="map-plays-scale" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>{t("map.legendMany")}</span>
    </div>
  );
}

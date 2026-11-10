// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useT } from "@/contexts/I18nContext";
import {
  boundsOf,
  centreOn,
  constellation,
  easeInOut,
  fitView,
  flight,
  resizeView,
  toMap,
  zoomAt,
  type MapView,
  type Spot,
} from "@/lib/libraryMap";
import { SpatialIndex } from "@/lib/spatialIndex";
import type { MapPoint } from "@/lib/types";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { coverTile } from "./covers";
import { landmarkAt, mapLandmarks, visibleLandmarks } from "./landmarks";
import { CARD_WIDTH_PX, MapTrackCard, type MapCard } from "./MapTrackCard";
import { createMapPainter } from "./painter";
import { buildStarfield } from "./starfield";
import { useMapGestures } from "./useMapGestures";

export interface MapLabel {
  text: string;
  x: number;
  y: number;
  strong?: boolean;
}

export interface MapRoute {
  at: MapPoint;
  behind: MapPoint[];
  ahead: MapPoint[];
}

export const MAP_LAYERS = ["route", "covers", "links", "nebula", "motion"] as const;

export type MapLayer = (typeof MAP_LAYERS)[number];

export interface MapController {
  zoomBy: (factor: number) => void;
  reset: () => void;
  locate: (id: string) => void;
}

const HIT_RADIUS_PX = 14;
const LOCATE_ZOOM = 5;
const FLIGHT_MS = 700;
const INTRO_MS = 1600;
const REVEAL_MS = 900;
const AMBIENT_FRAME_MS = 33;
const NO_LINKS: [number, number][] = [];

type Placed = MapCard;

export function LibraryMapCanvas({
  points,
  labels,
  highlightGenre,
  nowPlayingId,
  playing,
  route,
  path,
  layers,
  selecting,
  selectedIds,
  onSelect,
  onPlay,
  onRadio,
  controllerRef,
}: {
  points: MapPoint[];
  labels: MapLabel[];
  highlightGenre: string | null;
  nowPlayingId: string | null;
  playing: boolean;
  route: MapRoute | null;
  path: MapPoint[] | null;
  layers: ReadonlySet<MapLayer>;
  selecting: boolean;
  selectedIds: ReadonlySet<string> | null;
  onSelect: (points: MapPoint[]) => void;
  onPlay: (point: MapPoint) => void;
  onRadio: (point: MapPoint) => void;
  controllerRef?: Ref<MapController>;
}) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const viewRef = useRef<MapView | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const frameRef = useRef<number | null>(null);
  const lassoRef = useRef<Spot[] | null>(null);
  const tweenRef = useRef<{ from: MapView; to: MapView; start: number; duration: number } | null>(
    null,
  );
  const motionRef = useRef(true);
  const introRef = useRef<number | null>(null);
  const revealRef = useRef(0);
  const scheduleRef = useRef(() => {});
  const dirtyRef = useRef(true);
  const paintedRef = useRef(0);
  const coverHitsRef = useRef<{ point: MapPoint; spot: Spot; radius: number }[]>([]);

  const [hovered, setHovered] = useState<Placed | null>(null);
  const [picked, setPicked] = useState<Placed | null>(null);

  const place = (point: MapPoint, at: Spot): Placed => ({
    point,
    at,
    flip: at.x > sizeRef.current.width - CARD_WIDTH_PX,
  });

  const maxPlays = useMemo(
    () => points.reduce((max, point) => Math.max(max, point.plays), 0),
    [points],
  );
  const bounds = useMemo(() => boundsOf(points), [points]);
  const spatial = useMemo(() => new SpatialIndex(points), [points]);
  const linksEnabled = layers.has("links");
  const links = useMemo(
    () => (linksEnabled ? constellation(points, 2, spatial) : NO_LINKS),
    [points, spatial, linksEnabled],
  );
  const landmarks = useMemo(() => mapLandmarks(points), [points]);
  const starfield = useMemo(() => buildStarfield(points), [points]);
  const shownLabels = labels;
  const shownRoute = layers.has("route") ? route : null;
  const covers = layers.has("covers");
  const nebula = layers.has("nebula");
  const animate = layers.has("motion");

  const latest = useRef({
    points,
    labels: shownLabels,
    highlightGenre,
    nowPlayingId,
    playing,
    route: shownRoute,
    path,
    covers,
    nebula,
    selectedIds,
    maxPlays,
    bounds,
    links,
    landmarks,
    starfield,
  });
  useEffect(() => {
    latest.current = {
      points,
      labels: shownLabels,
      highlightGenre,
      nowPlayingId,
      playing,
      route: shownRoute,
      path,
      covers,
      nebula,
      selectedIds,
      maxPlays,
      bounds,
      links,
      landmarks,
      starfield,
    };
  });

  const painter = useRef<ReturnType<typeof createMapPainter> | null>(null);

  const hoveredId = hovered?.point.id ?? picked?.point.id ?? null;
  const hoveredRef = useRef<string | null>(null);
  useEffect(() => {
    hoveredRef.current = hoveredId;
  });

  const draw = useCallback((now: number = performance.now()) => {
    frameRef.current = null;

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const { width, height } = sizeRef.current;
    if (!canvas || !context || !viewRef.current || width === 0) return;

    const tween = tweenRef.current;
    if (tween) {
      const share = Math.min(1, (now - tween.start) / tween.duration);
      viewRef.current = flight(tween.from, tween.to, easeInOut(share), width, height);
      if (share >= 1) tweenRef.current = null;
    }

    const motion = motionRef.current;
    introRef.current ??= now;
    const intro = motion ? Math.min(1, (now - introRef.current) / INTRO_MS) : 1;
    const reveal = motion ? Math.min(1, (now - revealRef.current) / REVEAL_MS) : 1;

    const ambient = !tween && intro >= 1 && reveal >= 1 && !dirtyRef.current;
    if (ambient && now - paintedRef.current < AMBIENT_FRAME_MS) {
      scheduleRef.current();
      return;
    }
    const dirty = dirtyRef.current;
    dirtyRef.current = false;
    paintedRef.current = now;

    painter.current ??= createMapPainter(context);
    const moving = painter.current.draw(
      viewRef.current,
      sizeRef.current,
      {
        ...latest.current,
        hoveredId: hoveredRef.current,
        lasso: lassoRef.current,
        time: now,
        motion,
        intro,
        reveal,
        cover: (point) =>
          coverTile(point, () => {
            dirtyRef.current = true;
            scheduleRef.current();
          }),
        coverHits: coverHitsRef,
      },
      dirty,
    );

    if (moving || tweenRef.current || intro < 1 || reveal < 1) scheduleRef.current();
  }, []);

  const redraw = useCallback(() => {
    dirtyRef.current = true;
    frameRef.current ??= requestAnimationFrame(draw);
  }, [draw]);
  useEffect(() => {
    scheduleRef.current = () => {
      frameRef.current ??= requestAnimationFrame(draw);
    };
  }, [draw]);

  const setView = useCallback(
    (next: MapView) => {
      tweenRef.current = null;
      viewRef.current = next;
      setPicked(null);
      setHovered(null);
      redraw();
    },
    [redraw],
  );

  const flyTo = useCallback(
    (next: MapView, duration = FLIGHT_MS) => {
      const view = viewRef.current;
      if (!view || !motionRef.current) {
        setView(next);
        return;
      }

      tweenRef.current = { from: view, to: next, start: performance.now(), duration };
      setPicked(null);
      setHovered(null);
      redraw();
    },
    [redraw, setView],
  );

  useImperativeHandle(
    controllerRef,
    () => ({
      zoomBy: (factor) => {
        const view = tweenRef.current?.to ?? viewRef.current;
        const { width, height } = sizeRef.current;
        if (view) flyTo(zoomAt(view, factor, { x: width / 2, y: height / 2 }), FLIGHT_MS / 2);
      },
      reset: () =>
        flyTo(fitView(sizeRef.current.width, sizeRef.current.height, latest.current.bounds)),
      locate: (id) => {
        const point = latest.current.points.find((candidate) => candidate.id === id);
        const { width, height } = sizeRef.current;
        if (point) flyTo(centreOn(point, LOCATE_ZOOM, width, height));
      },
    }),
    [flyTo],
  );

  useEffect(() => {
    if (path) revealRef.current = performance.now();
  }, [path]);

  useEffect(() => {
    redraw();
  }, [
    points,
    shownLabels,
    highlightGenre,
    nowPlayingId,
    playing,
    shownRoute,
    path,
    covers,
    nebula,
    links,
    selectedIds,
    hoveredId,
    redraw,
  ]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      motionRef.current = animate && !query.matches;
      redraw();
    };

    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [animate, redraw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const resize = () => {
      const { width, height } = wrap.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const ratio = window.devicePixelRatio || 1;
      const previous = sizeRef.current;

      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      sizeRef.current = { width, height };

      const view = viewRef.current;
      tweenRef.current = null;
      viewRef.current = view
        ? resizeView(view, previous, { width, height })
        : fitView(width, height, latest.current.bounds);

      dirtyRef.current = true;
      draw();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const themeChanged = () => {
      painter.current?.themeChanged();
      redraw();
    };
    const themes = new MutationObserver(themeChanged);
    themes.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-colorway", "style"],
    });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", themeChanged);
    document.fonts?.addEventListener("loadingdone", themeChanged);

    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const view = viewRef.current;
      if (!view) return;

      const box = canvas.getBoundingClientRect();
      setView(
        zoomAt(view, Math.exp(-event.deltaY * 0.0015), {
          x: event.clientX - box.left,
          y: event.clientY - box.top,
        }),
      );
    };
    canvas.addEventListener("wheel", wheel, { passive: false });

    return () => {
      observer.disconnect();
      themes.disconnect();
      scheme.removeEventListener("change", themeChanged);
      document.fonts?.removeEventListener("loadingdone", themeChanged);
      painter.current?.destroy();
      painter.current = null;
      canvas.removeEventListener("wheel", wheel);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [draw, redraw, setView]);

  const nearest = (at: Spot): MapPoint | null => {
    const view = viewRef.current;
    if (!view) return null;

    const base = Math.min(sizeRef.current.width, sizeRef.current.height);
    if (covers) {
      const landmark = landmarkAt(
        visibleLandmarks(landmarks, view, sizeRef.current, highlightGenre, selectedIds),
        at,
      );
      if (landmark) return landmark;
      for (let i = coverHitsRef.current.length - 1; i >= 0; i--) {
        const hit = coverHitsRef.current[i];
        if (Math.hypot(hit.spot.x - at.x, hit.spot.y - at.y) <= hit.radius) return hit.point;
      }
    }
    const hit = spatial.nearest(toMap(at, view, base), 1, {
      radius: HIT_RADIUS_PX / (base * view.k),
    })[0];
    return hit ? points[hit.index] : null;
  };

  const { onPointerDown, onPointerMove, onPointerUp, onKeyDown } = useMapGestures({
    canvasRef,
    viewRef,
    sizeRef,
    lassoRef,
    tweenRef,
    points,
    bounds,
    selecting,
    nearest,
    place,
    setHovered,
    setPicked,
    setView,
    flyTo,
    redraw,
    onSelect,
  });

  const card = picked ?? hovered;

  return (
    <div ref={wrapRef} className="library-map-surface absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label={t("map.region", { count: points.length })}
        className={`absolute inset-0 h-full w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
          selecting ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHovered(null)}
        onKeyDown={onKeyDown}
      />

      {card && (
        <MapTrackCard
          card={card}
          picked={Boolean(picked)}
          onPlay={onPlay}
          onRadio={onRadio}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { genreName } from "@/lib/format";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  boundsOf,
  centreOn,
  constellation,
  easeInOut,
  fitView,
  flight,
  pointInPolygon,
  resizeView,
  toMap,
  toScreen,
  zoomAt,
  type MapView,
  type Spot,
} from "@/lib/libraryMap";
import { coverTile } from "./covers";
import { landmarkAt, mapLandmarks, visibleLandmarks } from "./landmarks";
import { paintMap, readPalette, type HaloCache } from "./paint";
import type { MapPoint } from "@/lib/types";
import { useT } from "@/contexts/I18nContext";
import { Cover } from "@/components/Cover";
import { Button } from "@/components/ui/button";
import { PlayIcon, RadioIcon, XIcon } from "lucide-react";

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

export const MAP_LAYERS = ["route", "covers", "links", "motion"] as const;

export type MapLayer = (typeof MAP_LAYERS)[number];

export interface MapController {
  zoomBy: (factor: number) => void;
  reset: () => void;
  locate: (id: string) => void;
}

const HIT_RADIUS_PX = 14;
const CLICK_SLOP_PX = 5;
const LOCATE_ZOOM = 5;
const CARD_WIDTH_PX = 290;
const FLIGHT_MS = 700;
const KEY_FLIGHT_MS = 220;
const INTRO_MS = 1600;
const REVEAL_MS = 900;
const AMBIENT_FRAME_MS = 33;
const NO_LINKS: [number, number][] = [];

interface Placed {
  point: MapPoint;
  at: Spot;
  flip: boolean;
}

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
  const pointersRef = useRef(new Map<number, Spot>());
  const gestureRef = useRef<{ start: Spot; moved: boolean; pinch: number | null } | null>(null);
  const tweenRef = useRef<{ from: MapView; to: MapView; start: number; duration: number } | null>(
    null,
  );
  const motionRef = useRef(true);
  const introRef = useRef<number | null>(null);
  const revealRef = useRef(0);
  const scheduleRef = useRef(() => {});
  const dirtyRef = useRef(true);
  const paintedRef = useRef(0);

  const [hovered, setHovered] = useState<Placed | null>(null);
  const [picked, setPicked] = useState<Placed | null>(null);

  const place = (point: MapPoint, at: Spot): Placed => ({
    point,
    at,
    flip: at.x > sizeRef.current.width - CARD_WIDTH_PX,
  });

  const maxPlays = points.reduce((max, point) => Math.max(max, point.plays), 0);
  const bounds = useMemo(() => boundsOf(points), [points]);
  const allLinks = useMemo(() => constellation(points), [points]);
  const landmarks = useMemo(() => mapLandmarks(points), [points]);
  const links = layers.has("links") ? allLinks : NO_LINKS;
  const shownLabels = labels;
  const shownRoute = layers.has("route") ? route : null;
  const covers = layers.has("covers");
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
    selectedIds,
    maxPlays,
    bounds,
    links,
    landmarks,
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
      selectedIds,
      maxPlays,
      bounds,
      links,
      landmarks,
    };
  });

  const halo = useRef<HaloCache | null>(null);

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
    dirtyRef.current = false;
    paintedRef.current = now;

    const moving = paintMap(context, readPalette(canvas), viewRef.current, sizeRef.current, halo, {
      ...latest.current,
      hoveredId: hoveredRef.current,
      lasso: lassoRef.current,
      time: now,
      motion,
      intro,
      reveal,
      cover: (point) => coverTile(point, () => scheduleRef.current()),
    });

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

    const themes = new MutationObserver(redraw);
    themes.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-colorway"],
    });
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", redraw);

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
      scheme.removeEventListener("change", redraw);
      canvas.removeEventListener("wheel", wheel);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [draw, redraw, setView]);

  const local = (event: { clientX: number; clientY: number }): Spot => {
    const box = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

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
    }
    let best: MapPoint | null = null;
    let bestDistance = HIT_RADIUS_PX ** 2;

    for (const point of points) {
      const spot = toScreen(point, view, base);
      const distance = (spot.x - at.x) ** 2 + (spot.y - at.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }

    return best;
  };

  const pinchSpan = () => {
    const [a, b] = [...pointersRef.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = local(event);
    pointersRef.current.set(event.pointerId, at);

    if (pointersRef.current.size === 2) {
      lassoRef.current = null;
      gestureRef.current = { start: at, moved: true, pinch: pinchSpan() };
      return;
    }

    gestureRef.current = { start: at, moved: false, pinch: null };
    if (selecting) lassoRef.current = [at];
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const at = local(event);
    const gesture = gestureRef.current;
    const previous = pointersRef.current.get(event.pointerId);

    if (!gesture || !previous) {
      if (event.pointerType === "mouse") {
        const point = nearest(at);
        setHovered((shown) =>
          point ? (shown?.point.id === point.id ? shown : place(point, at)) : null,
        );
      }
      return;
    }

    pointersRef.current.set(event.pointerId, at);

    if (
      !gesture.moved &&
      Math.hypot(at.x - gesture.start.x, at.y - gesture.start.y) > CLICK_SLOP_PX
    ) {
      gesture.moved = true;
    }

    const view = viewRef.current;
    if (!view || !gesture.moved) return;

    if (gesture.pinch !== null && pointersRef.current.size === 2) {
      const span = pinchSpan();
      const [a, b] = [...pointersRef.current.values()];
      setView(zoomAt(view, span / gesture.pinch, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
      gesture.pinch = span;
      return;
    }

    if (lassoRef.current) {
      lassoRef.current.push(at);
      redraw();
      return;
    }

    setView({ ...view, panX: view.panX + at.x - previous.x, panY: view.panY + at.y - previous.y });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId);
    const gesture = gestureRef.current;
    if (pointersRef.current.size > 0) return;

    gestureRef.current = null;
    const lasso = lassoRef.current;
    lassoRef.current = null;

    const at = local(event);
    const view = viewRef.current;

    if (lasso && lasso.length > 2 && gesture?.moved && view) {
      const base = Math.min(sizeRef.current.width, sizeRef.current.height);
      const polygon = lasso.map((spot) => toMap(spot, view, base));
      onSelect(points.filter((point) => pointInPolygon(point, polygon)));
      redraw();
      return;
    }

    redraw();
    if (gesture?.moved) return;

    const point = nearest(at);
    setHovered(null);
    setPicked(point ? place(point, at) : null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const view = tweenRef.current?.to ?? viewRef.current;
    if (!view) return;

    const { width, height } = sizeRef.current;
    const centre = { x: width / 2, y: height / 2 };
    const step = 60;

    const next: Record<string, () => MapView> = {
      "+": () => zoomAt(view, 1.4, centre),
      "=": () => zoomAt(view, 1.4, centre),
      "-": () => zoomAt(view, 1 / 1.4, centre),
      "0": () => fitView(width, height, latest.current.bounds),
      ArrowLeft: () => ({ ...view, panX: view.panX + step }),
      ArrowRight: () => ({ ...view, panX: view.panX - step }),
      ArrowUp: () => ({ ...view, panY: view.panY + step }),
      ArrowDown: () => ({ ...view, panY: view.panY - step }),
    };

    if (event.key === "Escape") {
      setPicked(null);
      return;
    }

    const move = next[event.key];
    if (!move) return;

    event.preventDefault();
    flyTo(move(), event.key === "0" ? FLIGHT_MS : KEY_FLIGHT_MS);
  };

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
        <div
          className={`map-track-card absolute z-10 flex max-w-[17rem] items-center gap-2.5 rounded-lg bg-popover p-2 text-popover-foreground shadow-pop ${
            picked ? "" : "pointer-events-none"
          }`}
          style={{
            left: `clamp(1rem, ${card.at.x + (card.flip ? -CARD_WIDTH_PX : 14)}px, calc(100% - var(--map-card-width) - 1rem))`,
            top: `clamp(1rem, ${card.at.y - 28}px, calc(100% - 6rem))`,
          }}
          role={picked ? "dialog" : undefined}
          aria-label={picked ? card.point.title : undefined}
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
                onClick={() => onPlay(picked.point)}
                aria-label={t("action.playNamed", { name: picked.point.title })}
              >
                <PlayIcon size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onRadio(picked.point)}
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
              onClick={() => setPicked(null)}
              aria-label={t("action.close")}
            >
              <XIcon size={12} />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich
"use client";

import {
  fitView,
  pointInPolygon,
  toMap,
  zoomAt,
  type Bounds,
  type MapView,
  type Spot,
} from "@/lib/libraryMap";
import type { MapPoint } from "@/lib/types";
import { useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { MapCard } from "./MapTrackCard";

const CLICK_SLOP_PX = 5;
const FLIGHT_MS = 700;
const KEY_FLIGHT_MS = 220;
interface GestureInput {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  viewRef: RefObject<MapView | null>;
  sizeRef: RefObject<{ width: number; height: number }>;
  lassoRef: RefObject<Spot[] | null>;
  tweenRef: RefObject<{ from: MapView; to: MapView; start: number; duration: number } | null>;
  points: MapPoint[];
  bounds: Bounds | null;
  selecting: boolean;
  nearest: (at: Spot) => MapPoint | null;
  place: (point: MapPoint, at: Spot) => MapCard;
  setHovered: Dispatch<SetStateAction<MapCard | null>>;
  setPicked: Dispatch<SetStateAction<MapCard | null>>;
  setView: (view: MapView) => void;
  flyTo: (view: MapView, duration?: number) => void;
  redraw: () => void;
  onSelect: (points: MapPoint[]) => void;
}

export function useMapGestures({
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
}: GestureInput) {
  const pointersRef = useRef(new Map<number, Spot>());
  const gestureRef = useRef<{ start: Spot; moved: boolean; pinch: number | null } | null>(null);
  const local = (event: { clientX: number; clientY: number }): Spot => {
    const box = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
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
      "0": () => fitView(width, height, bounds),
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

  return { onPointerDown, onPointerMove, onPointerUp, onKeyDown };
}

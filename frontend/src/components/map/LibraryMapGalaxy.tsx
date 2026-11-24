// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { Cover } from "@/components/Cover";
import { useT } from "@/contexts/I18nContext";
import type { Spot } from "@/lib/libraryMap";
import { useMotionVisibility } from "@/lib/useMotionVisibility";
import { useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { createGalaxyScene, type GalaxyScene } from "./galaxyScene";
import type { MapSurfaceProps } from "./LibraryMapCanvas";
import { CARD_WIDTH_PX, MapTrackCard, MapTrackPanel, type MapCard } from "./MapTrackCard";

const DRAG_THRESHOLD = 5;
const LANDMARK_DELAY = 115;

export function LibraryMapGalaxy(props: MapSurfaceProps & { onUnavailable: () => void }) {
  const { onUnavailable, onSelect, onPlay, onRadio, selecting, layers, controllerRef } = props;
  const t = useT();
  const { reduced } = useMotionVisibility();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GalaxyScene | null>(null);
  const latest = useRef(props);
  const gesture = useRef<{ pointers: Set<number>; origin: Spot; moved: boolean } | null>(null);
  const lasso = useRef<{ pointer: number; polygon: Spot[] } | null>(null);
  const [outline, setOutline] = useState("");
  const [hovered, setHovered] = useState<MapCard | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [landmarks, setLandmarks] = useState<ReturnType<GalaxyScene["landmarks"]>>([]);

  useLayoutEffect(() => {
    latest.current = props;
  });

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let scene: GalaxyScene;
    let settled: ReturnType<typeof setTimeout> | undefined;
    try {
      scene = createGalaxyScene(canvas, {
        onUnavailable,
        onNavigate: () => setHovered(null),
        onView: () => {
          const { labels, highlightGenre, selectedIds } = latest.current;
          const label = labelRef.current;
          const spot = labels[0] && scene.project(labels[0]);
          if (label) {
            label.hidden = !spot;
            if (spot) {
              label.style.left = `${spot.x}px`;
              label.style.top = `${spot.y}px`;
            }
          }

          const details = detailsRef.current;
          if (details) details.style.visibility = "hidden";
          clearTimeout(settled);
          settled = setTimeout(() => {
            setLandmarks(scene.landmarks(highlightGenre, selectedIds));
            if (details) details.style.visibility = "";
          }, LANDMARK_DELAY);
        },
      });
    } catch {
      onUnavailable();
      return;
    }
    sceneRef.current = scene;
    return () => {
      clearTimeout(settled);
      scene.dispose();
      sceneRef.current = null;
    };
  }, [onUnavailable]);

  const { points, labels, highlightGenre, nowPlayingId, playing, route, path, selectedIds } = props;
  useLayoutEffect(() => {
    sceneRef.current?.setPoints(points);
  }, [points, onUnavailable]);

  useLayoutEffect(() => {
    sceneRef.current?.configure({
      highlightGenre,
      nowPlayingId,
      playing,
      route,
      path,
      layers,
      selectedIds,
      pickedId: selecting ? null : pickedId,
    });
  }, [
    points,
    highlightGenre,
    nowPlayingId,
    playing,
    route,
    path,
    layers,
    selectedIds,
    selecting,
    pickedId,
    onUnavailable,
  ]);

  useLayoutEffect(() => {
    sceneRef.current?.setSelecting(selecting);
  }, [selecting, onUnavailable]);

  useLayoutEffect(() => {
    sceneRef.current?.setMotion(layers.has("motion") && !reduced);
  }, [layers, reduced, onUnavailable]);

  useImperativeHandle(
    controllerRef,
    () => ({
      zoomBy: (factor) => sceneRef.current?.zoomBy(factor),
      reset: () => sceneRef.current?.reset(),
      locate: (id) => sceneRef.current?.locate(id),
    }),
    [],
  );

  function local(event: PointerEvent<HTMLCanvasElement>): Spot {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.focus({ preventScroll: true });
    const at = local(event);
    if (selecting) {
      if (lasso.current || event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      lasso.current = { pointer: event.pointerId, polygon: [at] };
      return;
    }
    if (gesture.current) {
      gesture.current.pointers.add(event.pointerId);
      gesture.current.moved = true;
    } else {
      gesture.current = {
        pointers: new Set([event.pointerId]),
        origin: at,
        moved: event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey,
      };
    }
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const at = local(event);
    if (selecting) {
      const drawing = lasso.current;
      if (!drawing || drawing.pointer !== event.pointerId) return;
      const last = drawing.polygon.at(-1)!;
      if (Math.hypot(at.x - last.x, at.y - last.y) >= DRAG_THRESHOLD) {
        drawing.polygon.push(at);
        setOutline(`M${drawing.polygon.map(({ x, y }) => `${x},${y}`).join(" L")} Z`);
      }
      return;
    }
    const active = gesture.current;
    if (active) {
      if (Math.hypot(at.x - active.origin.x, at.y - active.origin.y) >= DRAG_THRESHOLD)
        active.moved = true;
      return;
    }
    if (event.pointerType !== "mouse" || picked) return;
    const hit = sceneRef.current?.hover(at);
    setHovered((previous) => {
      if (!hit) return null;
      if (hit.star.point === previous?.point) return previous;
      return {
        point: hit.star.point,
        at: hit.at,
        flip: hit.at.x > (canvasRef.current?.clientWidth ?? 0) - CARD_WIDTH_PX,
      };
    });
  }

  function finishPointer(event: PointerEvent<HTMLCanvasElement>, cancel = false) {
    const drawing = lasso.current;
    if (drawing?.pointer === event.pointerId) {
      lasso.current = null;
      setOutline("");
      if (!cancel && drawing.polygon.length >= 3) {
        setPickedId(null);
        onSelect(sceneRef.current?.lasso(drawing.polygon) ?? []);
      }
      return;
    }
    const active = gesture.current;
    if (!active?.pointers.delete(event.pointerId)) return;
    if (cancel) active.moved = true;
    if (active.pointers.size > 0) return;
    gesture.current = null;
    if (active.moved || selecting) return;

    const hit = sceneRef.current?.pick(local(event));
    setHovered(null);
    setPickedId(hit?.star.point.id ?? null);
  }

  const picked = !selecting && pickedId ? points.find((point) => point.id === pickedId) : undefined;
  const genreLabel = labels[0];

  return (
    <div className="library-map-surface galaxy-map-surface absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label={t("map.region", { count: points.length })}
        aria-describedby="galaxy-controls"
        className={`absolute inset-0 h-full w-full touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
          selecting ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={(event) => finishPointer(event, true)}
        onLostPointerCapture={(event) => finishPointer(event, true)}
        onPointerLeave={() => setHovered(null)}
        onContextMenu={(event) => event.preventDefault()}
        onBlur={() => sceneRef.current?.stopTravel()}
        onKeyUp={(event) => sceneRef.current?.stopTravelKey(event.code)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setPickedId(null);
            setHovered(null);
            if (selecting) {
              lasso.current = null;
              setOutline("");
              onSelect([]);
            }
          }
          if (
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            sceneRef.current?.startTravel(event.code)
          ) {
            event.preventDefault();
            return;
          }
          if (sceneRef.current?.key(event.key, event.shiftKey)) event.preventDefault();
        }}
      />
      <p id="galaxy-controls" className="sr-only">
        {t("map.galaxyControls")}
      </p>

      {genreLabel && (
        <div ref={labelRef} hidden className="galaxy-genre-label">
          {genreLabel.text}
        </div>
      )}

      <div ref={detailsRef} className="pointer-events-none absolute inset-0" aria-hidden="true">
        {landmarks
          .filter(({ point }) => point.id !== picked?.id)
          .map(({ point, at }) => (
            <div key={point.id} className="galaxy-landmark" style={{ left: at.x, top: at.y }}>
              {layers.has("covers") && point.hasCover && (
                <Cover
                  albumId={point.albumId}
                  trackId={point.id}
                  name={point.title}
                  size={27}
                  className="shrink-0 rounded-sm"
                />
              )}
              <span className="truncate">{point.title}</span>
            </div>
          ))}
      </div>

      {outline && (
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
          <path className="galaxy-lasso" d={outline} />
        </svg>
      )}

      {picked ? (
        <MapTrackPanel
          point={picked}
          raised={Boolean(selectedIds)}
          onPlay={onPlay}
          onRadio={onRadio}
          onClose={() => {
            setPickedId(null);
            canvasRef.current?.focus({ preventScroll: true });
          }}
        />
      ) : hovered && !selecting ? (
        <MapTrackCard card={hovered} />
      ) : null}
    </div>
  );
}

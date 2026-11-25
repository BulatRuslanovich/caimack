// SPDX-License-Identifier: AGPL-3.0-only

import { easeInOut, type Spot } from "@/lib/libraryMap";
import type { MapPoint } from "@/lib/types";
import { Box3, PerspectiveCamera, Scene, Spherical, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  fitGalaxy,
  GALAXY_FOV,
  galaxyPosition,
  galaxyProjector,
  lassoGalaxyPoints,
  MAP_TILT,
  MAX_DISTANCE,
  MIN_DISTANCE,
  pickGalaxyPoint,
} from "./galaxyMath";
import { createGalaxyObjects, type GalaxyContent, type GalaxyStar } from "./galaxyObjects";
import { readPalette } from "./paint";

const LOCATE_DISTANCE = 0.12;
const DETAIL_DEPTH = 0.49;
const LANDMARK_LIMIT = 8;
const FLIGHT_MS = 650;
const PULSE_FRAME_MS = 33;
const TAU = 2 * Math.PI;
const ARROW_PAN: Partial<Record<string, [number, number]>> = {
  ArrowLeft: [60, 0],
  ArrowRight: [-60, 0],
  ArrowUp: [0, 60],
  ArrowDown: [0, -60],
};
const TRAVEL_KEYS: Partial<Record<string, [number, number, number]>> = {
  KeyA: [-1, 0, 0],
  KeyD: [1, 0, 0],
  KeyQ: [0, -1, 0],
  KeyE: [0, 1, 0],
  KeyW: [0, 0, -1],
  KeyS: [0, 0, 1],
};

interface CameraView {
  target: Vector3;
  offset: Spherical;
}

export function createGalaxyScene(
  canvas: HTMLCanvasElement,
  events: { onView: () => void; onNavigate: () => void; onUnavailable: () => void },
) {
  const context = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    powerPreference: "high-performance",
  });
  if (!context) throw new Error("WebGL 2 is unavailable");
  const renderer = new WebGLRenderer({ canvas, context, alpha: true });
  const ratio = Math.min(1.5, window.devicePixelRatio || 1);
  renderer.setPixelRatio(ratio);
  const [, maxPointSize] = context.getParameter(context.ALIASED_POINT_SIZE_RANGE) as Float32Array;
  const scene = new Scene();
  const objects = createGalaxyObjects(scene, ratio, maxPointSize);
  const camera = new PerspectiveCamera(GALAXY_FOV, 1, 0.006, 40);
  camera.position.copy(MAP_TILT);
  const orbit = new OrbitControls(camera, canvas);
  orbit.zoomToCursor = true;
  orbit.minDistance = MIN_DISTANCE;
  orbit.maxDistance = MAX_DISTANCE;
  orbit.minPolarAngle = 0.025;
  orbit.maxPolarAngle = Math.PI - 0.025;
  const offset = new Vector3();
  const travel = new Vector3();
  const heldKeys = new Map<string, [number, number, number]>();
  let travelAt = 0;
  let width = 0;
  let height = 0;
  let dirty = true;
  let frame: number | null = null;
  let lastDraw = 0;
  let initialized = false;
  let disposed = false;
  let selecting = false;
  let motion = false;
  let pulsing = false;
  let stars: GalaxyStar[] = [];
  let byId = new Map<string, GalaxyStar>();
  let centre = new Vector3();
  let radius = 0;
  let flight: { from: CameraView; to: CameraView; start: number; duration: number } | null = null;

  const overview = (): CameraView => ({
    target: centre,
    offset: new Spherical().setFromVector3(
      MAP_TILT.clone().multiplyScalar(fitGalaxy(radius, camera.aspect)),
    ),
  });

  function apply(view: CameraView) {
    orbit.target.copy(view.target);
    camera.position.copy(view.target).add(offset.setFromSpherical(view.offset));
    orbit.update();
    // OrbitControls can suppress change events for subpixel camera movement.
    invalidateView();
  }

  function draw(now: number) {
    const animatePulse = pulsing && motion && !selecting;
    if (!dirty && !flight && !heldKeys.size && animatePulse && now - lastDraw < PULSE_FRAME_MS) {
      frame = requestAnimationFrame(draw);
      return;
    }
    lastDraw = now;
    if (flight) {
      const share = Math.min(1, (now - flight.start) / flight.duration);
      const t = easeInOut(share);
      const { from, to } = flight;
      apply({
        target: from.target.clone().lerp(to.target, t),
        offset: new Spherical(
          from.offset.radius * (to.offset.radius / from.offset.radius) ** t,
          from.offset.phi + (to.offset.phi - from.offset.phi) * t,
          from.offset.theta + (to.offset.theta - from.offset.theta) * t,
        ),
      });
      if (share === 1) flight = null;
    }
    if (heldKeys.size) {
      travel.set(0, 0, 0);
      for (const [x, y, z] of heldKeys.values()) {
        travel.x += x;
        travel.y += y;
        travel.z += z;
      }
      translate(Math.min(0.05, Math.max(0, (now - travelAt) / 1000)));
      travelAt = now;
    }
    objects.updateTime(animatePulse ? now * 0.004 : 0);
    renderer.render(scene, camera);
    if (dirty) {
      dirty = false;
      events.onView();
    }
    frame = null;
    if (flight || animatePulse || heldKeys.size) schedule();
  }

  function schedule() {
    if (!disposed && width > 0 && height > 0) frame ??= requestAnimationFrame(draw);
  }

  function invalidateView() {
    dirty = true;
    schedule();
  }

  function navigate() {
    flight = null;
    events.onNavigate();
  }

  function translate(seconds: number) {
    if (travel.lengthSq() === 0 || !seconds) return;
    const speed = Math.max(0.06, orbit.getDistance() * 0.92);
    travel
      .normalize()
      .applyQuaternion(camera.quaternion)
      .multiplyScalar(speed * seconds);
    camera.position.add(travel);
    orbit.target.add(travel);
    orbit.update();
    invalidateView();
  }

  function stopTravel() {
    heldKeys.clear();
  }

  function fly(view: CameraView, duration = FLIGHT_MS) {
    if (selecting) return;
    stopTravel();
    navigate();
    if (!motion) {
      apply(view);
      return;
    }
    const from = {
      target: orbit.target.clone(),
      offset: new Spherical().setFromVector3(offset.copy(camera.position).sub(orbit.target)),
    };
    const delta = view.offset.theta - from.offset.theta;
    view.offset.theta = from.offset.theta + delta - TAU * Math.round(delta / TAU);
    flight = { from, to: view, duration, start: performance.now() };
    schedule();
  }

  function zoomBy(factor: number) {
    const target = flight?.to.target ?? orbit.target;
    const next =
      flight?.to.offset.clone() ??
      new Spherical().setFromVector3(offset.copy(camera.position).sub(orbit.target));
    next.radius = Math.min(orbit.maxDistance, Math.max(orbit.minDistance, next.radius / factor));
    fly({ target, offset: next }, 260);
  }

  function reset() {
    fly(overview());
  }

  function resize() {
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    width = box.width;
    height = box.height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    orbit.maxDistance = Math.max(MAX_DISTANCE, fitGalaxy(radius, camera.aspect));
    objects.resize(height, camera.fov);
    fitFirstView();
    invalidateView();
  }

  function fitFirstView() {
    if (initialized || width === 0 || stars.length === 0) return;
    initialized = true;
    apply(overview());
  }

  function contextLost() {
    stopTravel();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    events.onUnavailable();
  }

  function projector() {
    camera.updateMatrixWorld();
    return galaxyProjector(camera, width, height);
  }

  orbit.addEventListener("change", invalidateView);
  orbit.addEventListener("start", navigate);
  canvas.addEventListener("webglcontextlost", contextLost);
  window.addEventListener("blur", stopTravel);
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const themeChanged = () => {
    objects.setPalette(readPalette(canvas));
    schedule();
  };
  const themes = new MutationObserver(themeChanged);
  themes.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-colorway", "data-cover-palette", "style"],
  });
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", themeChanged);
  themeChanged();
  resize();

  return {
    zoomBy,
    reset,
    locate(id: string) {
      const star = byId.get(id);
      if (!star) return;
      const direction = new Spherical().setFromVector3(
        offset.copy(camera.position).sub(orbit.target),
      );
      direction.radius = Math.min(direction.radius, LOCATE_DISTANCE);
      fly({ target: star.position, offset: direction });
    },
    setPoints(points: MapPoint[]) {
      stars = points.map((point) => ({ point, position: galaxyPosition(point) }));
      byId = new Map(stars.map((star) => [star.point.id, star]));
      const positions = stars.map(({ position }) => position);
      centre = new Box3().setFromPoints(positions).getCenter(new Vector3());
      radius = Math.sqrt(
        positions.reduce((max, p) => Math.max(max, p.distanceToSquared(centre)), 0),
      );
      orbit.maxDistance = Math.max(MAX_DISTANCE, fitGalaxy(radius, camera.aspect));
      objects.setStars(stars);
      fitFirstView();
      invalidateView();
    },
    configure(content: GalaxyContent) {
      objects.configure(content);
      pulsing = content.playing && content.nowPlayingId !== null && byId.has(content.nowPlayingId);
      invalidateView();
    },
    setMotion(animate: boolean) {
      motion = animate;
      if (!motion && flight) {
        apply(flight.to);
        flight = null;
      }
      schedule();
    },
    setSelecting(active: boolean) {
      selecting = active;
      orbit.enabled = !active;
      if (active) {
        stopTravel();
        navigate();
      }
      invalidateView();
    },
    startTravel(code: string) {
      const axes = TRAVEL_KEYS[code];
      if (selecting || !axes) return false;
      if (!heldKeys.has(code)) {
        if (!heldKeys.size) {
          navigate();
          travelAt = performance.now();
          travel.set(...axes);
          translate(0.04);
        }
        heldKeys.set(code, axes);
        schedule();
      }
      return true;
    },
    stopTravelKey(code: string) {
      heldKeys.delete(code);
    },
    stopTravel,
    key(key: string, shift: boolean) {
      if (selecting) return false;
      const arrow = ARROW_PAN[key];
      if (arrow) {
        navigate();
        const [x, y] = arrow;
        if (!shift) orbit.pan(x, y);
        else if (x) orbit.rotateLeft(x * 0.003);
        else orbit.rotateUp(y * 0.003);
      } else if (key === "0") reset();
      else if (key === "+" || key === "=") zoomBy(1.4);
      else if (key === "-") zoomBy(1 / 1.4);
      else return false;
      return true;
    },
    project(spot: Spot) {
      return projector()(galaxyPosition(spot));
    },
    pick(at: Spot) {
      return pickGalaxyPoint(stars, projector(), at, camera.position);
    },
    hover(at: Spot) {
      if (orbit.getDistance() >= 0.65) return null;
      return pickGalaxyPoint(stars, projector(), at, camera.position);
    },
    lasso(polygon: Spot[]) {
      return lassoGalaxyPoints(stars, projector(), polygon).map(({ point }) => point);
    },
    landmarks(genre: string | null, selectedIds: ReadonlySet<string> | null) {
      if (selecting || orbit.getDistance() >= 0.65) return [];
      const project = projector();
      const visible = stars.flatMap(({ point, position }) => {
        if ((genre && point.genre !== genre) || (selectedIds && !selectedIds.has(point.id)))
          return [];
        const at = project(position);
        return at &&
          at.depth < DETAIL_DEPTH &&
          at.x > 42 &&
          at.x < width - 125 &&
          at.y > 24 &&
          at.y < height - 24
          ? [{ point, at }]
          : [];
      });
      visible.sort((a, b) => a.at.depth - b.at.depth || b.point.plays - a.point.plays);
      const labels: typeof visible = [];
      for (const label of visible) {
        if (
          labels.some(
            ({ at }) => Math.abs(at.x - label.at.x) < 142 && Math.abs(at.y - label.at.y) < 42,
          )
        )
          continue;
        labels.push(label);
        if (labels.length >= LANDMARK_LIMIT) break;
      }
      return labels;
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      themes.disconnect();
      scheme.removeEventListener("change", themeChanged);
      if (frame !== null) cancelAnimationFrame(frame);
      orbit.dispose();
      objects.dispose();
      renderer.dispose();
      canvas.removeEventListener("webglcontextlost", contextLost);
      window.removeEventListener("blur", stopTravel);
    },
  };
}

export type GalaxyScene = ReturnType<typeof createGalaxyScene>;

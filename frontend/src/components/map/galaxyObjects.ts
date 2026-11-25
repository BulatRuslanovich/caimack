// SPDX-License-Identifier: AGPL-3.0-only

import { constellation, playsLevel } from "@/lib/libraryMap";
import type { Rgb } from "@/lib/cssColor";
import type { MapPoint } from "@/lib/types";
import {
  AdditiveBlending,
  BufferGeometry,
  CatmullRomCurve3,
  DataTexture,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  LinearFilter,
  NormalBlending,
  Points,
  RedFormat,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { galaxyPosition } from "./galaxyMath";
import type { MapSurfaceProps } from "./LibraryMapCanvas";
import type { Palette } from "./paint";
import { stellarColours } from "./starfield";

export type GalaxyContent = Pick<
  MapSurfaceProps,
  "highlightGenre" | "nowPlayingId" | "playing" | "route" | "path" | "layers" | "selectedIds"
> & { pickedId: string | null };

export interface GalaxyStar {
  point: MapPoint;
  position: Vector3;
}

const MAX_SOFT_LINKS = 1500;

const STAR_VERTEX = /* glsl */ `
  uniform float pixelRatio;
  uniform float sizeScale;
  attribute float level;
  attribute vec2 status;
  varying vec4 star;

  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    float perspective = clamp(1.25 / max(-view.z, 0.01), 0.65, 2.6);
    gl_PointSize = pixelRatio * clamp((4.2 + level * 4.0) * perspective * sizeScale
      + min(status.y, 2.0) * 5.0, 3.0, 35.0);
    gl_Position = projectionMatrix * view;
    float tone = clamp(0.48 + position.x * 0.65 + position.z * 0.55, 0.0, 1.0);
    star = vec4(level, status, tone);
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  uniform float time;
  uniform bool lightTheme;
  uniform vec3 pickColour;
  varying vec4 star;

  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float r = length(uv);
    float edge = 1.0 - smoothstep(0.70, 1.0, r);
    float core = exp(-r * r * 35.0);
    float glow = exp(-r * r * 7.0) * (0.28 + star.x * 0.22);
    vec3 color = mix(vec3(0.49, 0.71, 1.0), vec3(0.76, 0.55, 1.0), star.w);
    if (star.z > 0.5) {
      color = mix(color, vec3(0.36, 1.0, 0.81), 0.86);
    }
    if (star.z > 2.5) {
      color = pickColour;
      glow += 0.65 * (1.0 - smoothstep(0.035, 0.11, abs(r - 0.68)));
    } else if (star.z > 1.5) {
      color = vec3(0.47, 1.0, 0.84);
      glow += 0.56 * (1.0 - smoothstep(0.025, 0.085, abs(r - 0.56 - 0.07 * sin(time))));
    }
    vec3 center = lightTheme ? vec3(0.16, 0.20, 0.36) : vec3(0.96, 0.99, 1.0);
    if (lightTheme) color *= 0.62;
    gl_FragColor = vec4(mix(color, center, core * 0.75),
      (core + glow) * edge * (0.55 + star.x * 0.45) * star.y);
  }
`;

const CLOUD_VERTEX = /* glsl */ `
  uniform float focalLength;
  uniform float maxSize;
  attribute vec3 cloud;
  varying vec3 plume;

  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = clamp(cloud.x * focalLength / max(-view.z, 0.01), 1.0, maxSize);
    plume = cloud;
    plume.y *= smoothstep(0.025, 0.13, -view.z);
  }
`;

const CLOUD_FRAGMENT = /* glsl */ `
  uniform sampler2D cloudOpacity;
  varying vec3 plume;

  void main() {
    vec3 tint = mix(vec3(0.18, 0.46, 0.86), vec3(0.57, 0.22, 0.77), plume.z);
    gl_FragColor = vec4(tint, texture2D(cloudOpacity, gl_PointCoord).r * plume.y);
  }
`;

function cloudTexture() {
  // Sample the soft profile once, so overlapping nebulae only need a texture lookup.
  const size = 64;
  const opacity = new Uint8Array(size * size);
  for (let i = 0; i < opacity.length; i++) {
    const x = ((i % size) / (size - 1)) * 2 - 1;
    const y = (Math.floor(i / size) / (size - 1)) * 2 - 1;
    const r = Math.hypot(x + Math.sin(5 * y) * 0.13, y * 1.16);
    const veil = Math.max(0, 1 - r * r * 1.2) ** 2 * Math.exp(-r * r * 2.8);
    const fibers = 0.72 + 0.16 * Math.sin(9 * x + 5 * y) + 0.12 * Math.sin(13 * y - 7 * x);
    opacity[i] = Math.round(255 * veil * fibers);
  }
  const texture = new DataTexture(opacity, size, size, RedFormat);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function cloudGeometry(stars: GalaxyStar[]) {
  const cells = new Map<string, { centre: Vector3; count: number }>();
  for (const { position } of stars) {
    const key = position
      .toArray()
      .map((value) => Math.floor((value + 0.5) / 0.12))
      .join(",");
    let cell = cells.get(key);
    if (!cell) {
      cell = { centre: new Vector3(), count: 0 };
      cells.set(key, cell);
    }
    cell.centre.add(position);
    cell.count++;
  }
  const dense = [...cells.values()]
    .filter(({ count }) => count >= 4)
    .sort((a, b) => b.count - a.count)
    .slice(0, 36);

  const geometry = new BufferGeometry().setFromPoints(
    dense.map((cell) => cell.centre.divideScalar(cell.count)),
  );
  geometry.setAttribute(
    "cloud",
    new Float32BufferAttribute(
      dense.flatMap(({ centre, count }) => {
        const density = Math.min(1, Math.log2(count) / 8);
        return [
          0.2 + density * 0.21,
          0.09 + density * 0.21,
          Math.max(0, Math.min(1, 0.5 + centre.x + centre.z * 0.55)),
        ];
      }),
      3,
    ),
  );
  return geometry;
}

function setGeometry(object: Points | LineSegments, geometry: BufferGeometry) {
  object.geometry.dispose();
  object.geometry = geometry;
}

function softLine(linewidth: number, opacity: number) {
  const material = new LineMaterial({ linewidth, opacity, transparent: true, depthWrite: false });
  // Fade the screen-space edges and round caps in the shader without multisampling the scene.
  material.fragmentShader = /* glsl */ `
    uniform vec3 diffuse;
    uniform float opacity;
    varying vec2 vUv;

    void main() {
      float edge = length(vec2(vUv.x, max(abs(vUv.y) - 1.0, 0.0)));
      gl_FragColor = vec4(diffuse, opacity * (1.0 - smoothstep(0.3, 1.0, edge)));
      #include <colorspace_fragment>
    }
  `;
  return new LineSegments2(new LineSegmentsGeometry().setPositions([]), material);
}

function setLinePositions(line: LineSegments2, segments: number[]) {
  line.geometry.dispose();
  line.geometry = new LineSegmentsGeometry().setPositions(segments);
}

function appendSegment(segments: number[], start: Vector3, end: Vector3) {
  if (!start.equals(end)) segments.push(start.x, start.y, start.z, end.x, end.y, end.z);
}

function setPath(line: LineSegments2, points: MapPoint[]) {
  const knots: Vector3[] = [];
  for (const point of points) {
    const at = galaxyPosition(point);
    if (!knots.at(-1)?.equals(at)) knots.push(at);
  }
  const path =
    knots.length > 2 ? new CatmullRomCurve3(knots).getPoints((knots.length - 1) * 12) : knots;
  const segments: number[] = [];
  for (let i = 1; i < path.length; i++) {
    appendSegment(segments, path[i - 1], path[i]);
  }
  setLinePositions(line, segments);
}

function lineColour(material: LineMaterial | LineBasicMaterial, [r, g, b]: Rgb) {
  material.color.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
}

export function createGalaxyObjects(scene: Scene, pixelRatio: number, maxSize: number) {
  const starMaterial = new ShaderMaterial({
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    uniforms: {
      pixelRatio: { value: pixelRatio },
      sizeScale: { value: 1 },
      time: { value: 0 },
      lightTheme: { value: false },
      pickColour: { value: new Vector3(1, 0.8, 0.5) },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const stars = new Points(new BufferGeometry(), starMaterial);
  const cloudOpacity = cloudTexture();
  const cloudMaterial = new ShaderMaterial({
    vertexShader: CLOUD_VERTEX,
    fragmentShader: CLOUD_FRAGMENT,
    uniforms: {
      focalLength: { value: 0 },
      maxSize: { value: Math.min(maxSize, 280) },
      cloudOpacity: { value: cloudOpacity },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const clouds = new Points(new BufferGeometry(), cloudMaterial);
  const links = softLine(1.35, 0.18);
  // Dense constellations keep the inexpensive one-pixel renderer.
  const denseLinks = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({ opacity: 0.1, transparent: true, depthWrite: false }),
  );
  const behind = softLine(1.65, 0.23);
  const ahead = softLine(2.2, 0.62);
  const selection = softLine(1.9, 0.47);
  clouds.renderOrder = 0;
  links.renderOrder = denseLinks.renderOrder = 1;
  behind.renderOrder = ahead.renderOrder = selection.renderOrder = 2;
  stars.renderOrder = 3;
  const objects = [clouds, links, denseLinks, behind, ahead, selection, stars];
  scene.add(...objects);
  let catalog: GalaxyStar[] = [];
  let haveLinks = false;
  let softLinks = true;
  let haveClouds = false;
  let last: GalaxyContent | null = null;

  return {
    setPalette({ primary, ink, light }: Palette) {
      const linkColour = light ? ink : stellarColours(primary, light)[1];
      lineColour(links.material, linkColour);
      lineColour(denseLinks.material, linkColour);
      lineColour(behind.material, ink);
      lineColour(ahead.material, primary);
      lineColour(selection.material, primary);
      const blending = light ? NormalBlending : AdditiveBlending;
      starMaterial.blending = cloudMaterial.blending = blending;
      starMaterial.uniforms.lightTheme.value = light;
      starMaterial.uniforms.pickColour.value.set(
        primary[0] / 255,
        primary[1] / 255,
        primary[2] / 255,
      );
    },
    setStars(next: GalaxyStar[]) {
      catalog = next;
      haveLinks = haveClouds = false;
      last = null;
      const maxPlays = next.reduce((max, { point }) => Math.max(max, point.plays), 0);
      const geometry = new BufferGeometry().setFromPoints(next.map(({ position }) => position));
      geometry.setAttribute(
        "level",
        new Float32BufferAttribute(
          next.map(({ point }) => playsLevel(point.plays, maxPlays)),
          1,
        ),
      );
      geometry.setAttribute(
        "status",
        new Float32BufferAttribute(new Float32Array(next.length * 2), 2),
      );
      starMaterial.uniforms.sizeScale.value = next.length <= 3 ? 2.2 : next.length < 300 ? 1.35 : 1;
      setGeometry(stars, geometry);
    },
    configure(content: GalaxyContent) {
      clouds.visible = content.layers.has("nebula");
      if (clouds.visible && !haveClouds) {
        setGeometry(clouds, cloudGeometry(catalog));
        haveClouds = true;
      }
      const showLinks = content.layers.has("links");
      if (showLinks && !haveLinks) {
        const pairs = constellation(catalog.map(({ point }) => point));
        const segments: number[] = [];
        for (const [a, b] of pairs)
          appendSegment(segments, catalog[a].position, catalog[b].position);
        softLinks = segments.length / 6 <= MAX_SOFT_LINKS;
        setLinePositions(links, softLinks ? segments : []);
        const geometry = new BufferGeometry();
        if (!softLinks) geometry.setAttribute("position", new Float32BufferAttribute(segments, 3));
        setGeometry(denseLinks, geometry);
        haveLinks = true;
      }
      links.visible = showLinks && softLinks;
      denseLinks.visible = showLinks && !softLinks;

      if (
        last?.route !== content.route ||
        last?.layers.has("route") !== content.layers.has("route")
      ) {
        const route = content.layers.has("route") ? content.route : null;
        setPath(behind, route ? [...route.behind, route.at] : []);
        setPath(ahead, route ? [route.at, ...route.ahead] : []);
      }
      if (last?.path !== content.path) {
        setPath(selection, content.path ?? []);
      }
      if (
        last?.highlightGenre !== content.highlightGenre ||
        last?.selectedIds !== content.selectedIds ||
        last?.nowPlayingId !== content.nowPlayingId ||
        last?.pickedId !== content.pickedId
      ) {
        const status = stars.geometry.getAttribute("status");
        catalog.forEach(({ point }, index) => {
          const genre = content.highlightGenre === point.genre;
          const selected = content.selectedIds?.has(point.id);
          const bright = (!content.highlightGenre || genre) && (!content.selectedIds || selected);
          const current = point.id === content.nowPlayingId;
          const picked = point.id === content.pickedId;
          status.setXY(
            index,
            bright || current || picked ? 1 : 0.21,
            current ? 2 : picked ? 3 : selected || genre ? 1 : 0,
          );
        });
        status.needsUpdate = true;
      }
      last = content;
    },
    resize(height: number, fov: number) {
      cloudMaterial.uniforms.focalLength.value =
        (height * pixelRatio) / (2 * Math.tan((fov * Math.PI) / 360));
    },
    updateTime(time: number) {
      starMaterial.uniforms.time.value = time;
    },
    dispose() {
      scene.remove(...objects);
      cloudOpacity.dispose();
      for (const object of objects) {
        object.geometry.dispose();
        object.material.dispose();
      }
    },
  };
}

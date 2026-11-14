// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { PLAYER_EFFECTS, type PlayerEffect } from "@/lib/playerEffects";
import type { AudioMotionFrame } from "./audioMotion";
import { MOTION_BANDS } from "./audioMotion";
import { createEffectLayout } from "./effectLayout";
import type { EffectPalette } from "./effectPalette";
import { materialLevels } from "./materialLevels";
import { ribbonControls, RibbonWaves } from "./soundGeometry";

import { createCanvasEffectsRenderer } from "./canvasEffectsRenderer";
import { fragment, vertex } from "./effectShaders";
import { softBand } from "./softBand";

export interface EffectFrame extends AudioMotionFrame {
  effect: PlayerEffect;
  delta: number;
  intensity: number;
  palette: EffectPalette;
  light: boolean;
}
export interface EffectsRenderer {
  draw(frame: EffectFrame): void;
  destroy(): void;
  kind: string;
}

export function createEffectsRenderer(
  canvas: HTMLCanvasElement,
  trackKey = "",
): EffectsRenderer | null {
  const layout = createEffectLayout(trackKey);
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    powerPreference: "low-power",
  });
  if (!gl) return createCanvasEffectsRenderer(canvas, layout);
  const program = (source: string, names: string[]) => {
    const shaders = [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].map((type, i) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, i ? source : vertex);
      gl.compileShader(shader);
      return shader;
    });
    if (shaders.some((shader) => !gl.getShaderParameter(shader, gl.COMPILE_STATUS))) {
      canvas.dataset.shaderError = shaders.map((s) => gl.getShaderInfoLog(s)).join(" ");
      shaders.forEach((s) => gl.deleteShader(s));
      return null;
    }
    const handle = gl.createProgram()!;
    shaders.forEach((s) => gl.attachShader(handle, s));
    gl.linkProgram(handle);
    shaders.forEach((s) => gl.deleteShader(s));
    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
      canvas.dataset.shaderError = gl.getProgramInfoLog(handle) ?? "Link failed";
      gl.deleteProgram(handle);
      return null;
    }
    return {
      handle,
      position: gl.getAttribLocation(handle, "position"),
      uniforms: Object.fromEntries(
        names.map((name) => [name, gl.getUniformLocation(handle, name)]),
      ),
    };
  };
  const main = program(fragment, [
    "resolution",
    "bass",
    "mid",
    "high",
    "pulse",
    "presence",
    "energy",
    "intensity",
    "light",
    "primary",
    "secondary",
    "accent",
    "material",
    "lenses[0]",
    "lensOptics[0]",
    "layoutSeed",
    "effect",
    "beatEvents[0]",
    "sparkEvents[0]",
    "ribbons[0]",
    "ribbonPhase[0]",
    "spectrum",
  ]);
  if (!main) return null;
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const spectrumTexture = gl.createTexture()!;
  const spectrumPixels = new Uint8Array(MOTION_BANDS * 4);
  gl.bindTexture(gl.TEXTURE_2D, spectrumTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    MOTION_BANDS,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    spectrumPixels,
  );
  const bind = (p: NonNullable<typeof main>) => {
    gl.useProgram(p.handle);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(p.position);
    gl.vertexAttribPointer(p.position, 2, gl.FLOAT, false, 0, 0);
  };
  const ribbonWaves = new RibbonWaves();
  return {
    kind: "webgl",
    draw(frame) {
      if (gl.isContextLost()) return;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      bind(main);
      const u = main.uniforms;
      gl.uniform2f(u.resolution, canvas.width, canvas.height);
      gl.uniform3fv(u.material, materialLevels(frame));
      gl.uniform4fv(u["lenses[0]"], layout.lenses);
      gl.uniform4fv(u["lensOptics[0]"], layout.optics);
      gl.uniform1f(u.layoutSeed, layout.seed);
      const controls = ribbonControls(frame.spectrum);
      gl.uniform4fv(u["ribbons[0]"], controls);
      gl.uniform1fv(
        u["ribbonPhase[0]"],
        ribbonWaves.step(controls, frame.effect === "aurora" ? frame.delta : 0),
      );
      for (const key of [
        "bass",
        "mid",
        "high",
        "pulse",
        "presence",
        "energy",
        "intensity",
      ] as const)
        gl.uniform1f(u[key], frame[key]);
      gl.uniform1f(u.light, frame.light ? 1 : 0);
      gl.uniform1i(u.effect, PLAYER_EFFECTS.indexOf(frame.effect));
      frame.palette.forEach((color, i) =>
        gl.uniform3f(
          u[["primary", "secondary", "accent"][i]],
          color[0] / 255,
          color[1] / 255,
          color[2] / 255,
        ),
      );
      gl.uniform4fv(u["beatEvents[0]"], frame.beatEvents);
      gl.uniform4fv(u["sparkEvents[0]"], frame.sparkEvents);
      for (let i = 0; i < MOTION_BANDS; i++) {
        spectrumPixels[i * 4 + 3] = Math.round(softBand(frame.spectrum, i) * 255);
        spectrumPixels[i * 4] = Math.round(softBand(frame.transients, i) * 255);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, spectrumTexture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        MOTION_BANDS,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        spectrumPixels,
      );
      gl.uniform1i(u.spectrum, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    destroy() {
      gl.deleteTexture(spectrumTexture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(main.handle);
    },
  };
}

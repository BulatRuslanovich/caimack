// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { MOTION_BANDS } from "./audioMotion";
import { createEffectLayout, GLASS_LENSES } from "./effectLayout";
import { materialLevels } from "./materialLevels";
import type { EffectsRenderer } from "./reactiveEffectsRenderer";
import { softBand } from "./softBand";
import { auroraCentre, ribbonControls, RibbonWaves, sampleBand } from "./soundGeometry";

export function createCanvasEffectsRenderer(
  canvas: HTMLCanvasElement,
  layout: ReturnType<typeof createEffectLayout>,
): EffectsRenderer | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const ribbonWaves = new RibbonWaves();
  const spectrum = new Float32Array(MOTION_BANDS);
  const transients = new Float32Array(MOTION_BANDS);
  return {
    kind: "canvas",
    draw(f) {
      const w = canvas.width,
        h = canvas.height;
      const color = (i: number, alpha: number) =>
        `rgba(${f.palette[i % 3].join(",")},${Math.max(0, Math.min(1, alpha))})`;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = f.intensity;
      if (f.effect === "glass") {
        const material = materialLevels(f);
        let stress = 0;
        for (let i = 0; i < 8; i++) {
          const age = f.beatEvents[i * 4];
          if (age >= 0 && age < 1.8)
            stress +=
              (1 - Math.exp((-age * age) / 0.0036)) * Math.exp(-age * 4) * f.beatEvents[i * 4 + 1];
        }
        stress = Math.min(1, stress);
        for (let i = 0; i < GLASS_LENSES; i++) {
          ctx.save();
          ctx.translate(w * layout.lenses[i * 4], h * layout.lenses[i * 4 + 1]);
          ctx.rotate(Math.atan2(layout.optics[i * 4 + 1], layout.optics[i * 4]));
          ctx.scale(1, layout.lenses[i * 4 + 3] / layout.lenses[i * 4 + 2]);
          const extent = Math.min(w, h) * layout.lenses[i * 4 + 2] * 2;
          const response = sampleBand(f.spectrum, layout.optics[i * 4 + 3]);
          const g = ctx.createLinearGradient(-extent, 0, extent, 0);
          g.addColorStop(0, color(i, 0));
          g.addColorStop(0.48 - material[2] * 0.02, color(i, 0.28));
          g.addColorStop(0.5, color(i, 0.55 + response * 0.35 + stress * 0.1));
          g.addColorStop(1, color(i, 0));
          ctx.fillStyle = g;
          ctx.fillRect(-extent, -h, extent * 2, h * 2);
          ctx.restore();
        }
      } else {
        f.spectrum.forEach((_, i) => (spectrum[i] = softBand(f.spectrum, i)));
        f.transients.forEach((_, i) => (transients[i] = softBand(f.transients, i)));
        const geometry = { spectrum, transients, beatEvents: f.beatEvents };
        const controls = ribbonControls(spectrum);
        const phases = ribbonWaves.step(controls, f.delta);
        const heightAt = (x: number, i: number) => {
          return h * (1 - auroraCentre(geometry, x, i, controls, phases[i]));
        };
        for (let i = 0; i < 5; i++) {
          ctx.beginPath();
          for (let step = 0; step <= 120; step++) {
            const x = step / 120;
            const y = heightAt(x, i);
            if (step === 0) ctx.moveTo(x * w, y);
            else ctx.lineTo(x * w, y);
          }
          const power = controls[i * 4];
          ctx.strokeStyle = color(i, 0.04 + power * 0.28);
          ctx.lineWidth = h * (0.018 + power * 0.035);
          ctx.stroke();
          const rim = ctx.createLinearGradient(0, 0, w, 0);
          const from = controls[i * 4 + 2],
            to = controls[i * 4 + 3];
          for (let bin = 0; bin < MOTION_BANDS; bin++) {
            const x = bin / (MOTION_BANDS - 1),
              frequency = from + (to - from) * x;
            rim.addColorStop(
              x,
              color(
                i,
                0.08 +
                  sampleBand(spectrum, frequency) * 0.7 +
                  sampleBand(transients, frequency) * 0.5,
              ),
            );
          }
          ctx.strokeStyle = rim;
          ctx.lineWidth = Math.max(1, h * 0.0025);
          ctx.stroke();
          for (let j = 0; j < 6; j++) {
            const age = f.sparkEvents[j * 4];
            if (age < 0 || age >= 0.8) continue;
            const seed = f.sparkEvents[j * 4 + 2];
            const coupling = Math.exp(-2 * ((seed - (from + to) / 2) / (to - from + 1 / 23)) ** 2);
            const x = Math.max(0.05, Math.min(0.95, (seed - from) / (to - from))) + age * 0.12;
            ctx.beginPath();
            ctx.arc(x * w, heightAt(x, i), Math.max(1, h * 0.003), 0, Math.PI * 2);
            ctx.fillStyle = color(
              2,
              (1 - Math.exp((-age * age) / 0.0016)) *
                Math.exp(-age * 5) *
                f.sparkEvents[j * 4 + 1] *
                coupling,
            );
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;
    },
    destroy() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}

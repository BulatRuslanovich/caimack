// SPDX-License-Identifier: AGPL-3.0-only
import type { AudioMotionFrame } from "./audioMotion";
import { materialLevels } from "./materialLevels";
import { createEffectLayout, INK_FLOWS } from "./effectLayout";

export const INK_SOURCE_COUNT = INK_FLOWS;
export const INK_PLUME_SECONDS = 0.8;
export const INK_DOSE = 0.6;

export function inkVelocity(
  currents: Float32Array,
  x: number,
  y: number,
  aspect: number,
): [number, number] {
  let vx = 0,
    vy = 0;
  for (let i = 0; i < INK_FLOWS; i++) {
    const at = i * 4,
      dx = (x - currents[at]) * aspect,
      dy = y - currents[at + 1];
    const radius = currents[at + 3],
      strength = currents[at + 2],
      frequency = i / (INK_FLOWS - 1);
    const local = Math.exp(-(dx * dx + dy * dy) / (radius * radius));
    vx +=
      ((-dy / radius) * local * strength * 0.16) / aspect +
      Math.sin(y * (12 + frequency * 45)) * Math.abs(strength) * local * 0.009 * frequency;
    vy +=
      (dx / radius) * local * strength * 0.16 +
      Math.cos(x * (10 + frequency * 40)) * Math.abs(strength) * local * 0.009 * frequency;
  }
  return [vx, vy];
}

interface Plume {
  x: number;
  y: number;
  strength: number;
  seed: number;
  age: number;
  duration: number;
}
const integral = (phase: number) => {
  const t = Math.max(0, Math.min(1, phase));
  return t - Math.sin(2 * Math.PI * t) / (2 * Math.PI);
};

// A beat opens a small emitter with a smooth attack/release. Integrating its
// envelope gives the same pigment dose at different frame rates.
export class InkFlow {
  private plumes: Plume[] = [];
  readonly sources = new Float32Array(INK_SOURCE_COUNT * 4);
  readonly motion: [number, number, number] = [0, 0, 0];
  readonly currents = new Float32Array(INK_FLOWS * 4);
  readonly levels = new Float32Array(INK_FLOWS);
  private first = new Float64Array(INK_FLOWS);
  private second = new Float64Array(INK_FLOWS);
  private lastAttack = new Float32Array(INK_FLOWS);
  private lastEmission = new Float64Array(INK_FLOWS).fill(-1);
  private clock = 0;

  constructor(private anchors = createEffectLayout("").ink) {
    for (let i = 0; i < INK_FLOWS; i++) {
      this.currents.set([anchors[i * 4], anchors[i * 4 + 1], 0, anchors[i * 4 + 2]], i * 4);
    }
  }

  step(
    frame: Pick<AudioMotionFrame, "bass" | "mid" | "high" | "pigment"> &
      Partial<Pick<AudioMotionFrame, "spectrum" | "drive" | "transients">>,
    delta: number,
  ) {
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(delta) ? delta : 0));
    this.sources.fill(0);
    if (!dt) return this;
    this.clock += dt;
    const levels = materialLevels(frame);
    const drive = frame.drive ?? 0;
    const response = [0.32 - drive * 0.2, 0.85 - drive * 0.5, 0.5 - drive * 0.3];
    for (let i = 0; i < 3; i++)
      this.motion[i] += (levels[i] - this.motion[i]) * (1 - Math.exp(-dt / response[i]));
    if (frame.spectrum) {
      const weights = new Float32Array(INK_FLOWS);
      let total = 0,
        strongest = 0;
      for (let i = 0; i < INK_FLOWS; i++) {
        const target =
          (frame.spectrum[i * 2] + frame.spectrum[i * 2 + 1]) * 0.5 * (0.25 + drive * 0.75);
        const tau = 0.3 - (i / (INK_FLOWS - 1)) * 0.2;
        this.levels[i] += (target - this.levels[i]) * (1 - Math.exp(-dt / tau));
        this.currents[i * 4 + 2] = this.levels[i] * this.anchors[i * 4 + 3];
        const attack = frame.transients
          ? (frame.transients[i * 2] + frame.transients[i * 2 + 1]) * 0.5
          : 0;
        const rising =
          attack > this.lastAttack[i] + 0.012 && this.clock - this.lastEmission[i] > 0.14;
        weights[i] = frame.pigment[2] > 0.06 ? attack : rising && attack > 0.075 ? attack : 0;
        total += weights[i];
        strongest = Math.max(strongest, weights[i]);
        this.lastAttack[i] = attack;
      }
      const strength = frame.pigment[2] > 0.06 ? frame.pigment[2] : Math.min(0.18, strongest * 0.4);
      if (strength > 0) {
        if (!total) {
          const band = Math.min(
            INK_FLOWS - 1,
            Math.max(0, Math.floor(frame.pigment[3] * INK_FLOWS)),
          );
          weights[band] = 1;
          total = 1;
        }
        for (let i = 0; i < INK_FLOWS; i++)
          if (weights[i] > 0) {
            this.first[i] += (INK_DOSE * strength * weights[i]) / total;
            this.lastEmission[i] = this.clock;
          }
      }
      // Two reservoirs produce a smooth jet and conserve deposited pigment.
      // A repeated hit adds to the same emitter, preserving existing plumes.
      for (let i = 0; i < INK_FLOWS; i++) {
        const tau = (0.22 - (i / (INK_FLOWS - 1)) * 0.13) * (1 - drive * 0.35);
        const decay = Math.exp(-dt / tau),
          a = this.first[i],
          b = this.second[i];
        this.first[i] = a * decay;
        this.second[i] = (b + (a * dt) / tau) * decay;
        const dose = Math.max(0, a + b - this.first[i] - this.second[i]);
        this.sources.set(
          [this.anchors[i * 4], this.anchors[i * 4 + 1], dose, (i + 0.5) / INK_FLOWS],
          i * 4,
        );
      }
      return this;
    }
    const [x, y, strength, seed] = frame.pigment;
    if (Number.isFinite(strength) && strength > 0.06) {
      this.plumes.push({
        x,
        y,
        strength: Math.min(1, strength),
        seed,
        age: 0,
        duration: INK_PLUME_SECONDS * (1.5 - drive * 0.95),
      });
      if (this.plumes.length > INK_SOURCE_COUNT) this.plumes.shift();
    }
    this.plumes = this.plumes.filter((plume) => plume.age < plume.duration);
    this.plumes.forEach((plume, index) => {
      const from = integral(plume.age / plume.duration);
      plume.age += dt;
      const dose = (integral(plume.age / plume.duration) - from) * plume.strength * INK_DOSE;
      this.sources[index * 4] =
        plume.x + Math.sin(plume.seed * 6.28 + plume.age * 1.3) * plume.age * 0.008;
      this.sources[index * 4 + 1] = plume.y + plume.age * 0.015;
      this.sources[index * 4 + 2] = dose;
      this.sources[index * 4 + 3] = plume.seed;
    });
    return this;
  }
}

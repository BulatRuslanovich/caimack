// SPDX-License-Identifier: AGPL-3.0-only
import type { AudioMotionFrame } from "./audioMotion";

export const INK_SOURCE_COUNT = 6;
export const INK_PLUME_SECONDS = 0.8;
export const INK_DOSE = 0.6;

interface Plume {
  x: number;
  y: number;
  strength: number;
  seed: number;
  age: number;
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

  step(frame: Pick<AudioMotionFrame, "bass" | "mid" | "high" | "pigment">, delta: number) {
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(delta) ? delta : 0));
    this.sources.fill(0);
    if (!dt) return this;
    const levels = [frame.bass, frame.mid, frame.high];
    const response = [0.4, 0.85, 0.65];
    for (let i = 0; i < 3; i++)
      this.motion[i] += (levels[i] - this.motion[i]) * (1 - Math.exp(-dt / response[i]));
    const [x, y, strength, seed] = frame.pigment;
    if (Number.isFinite(strength) && strength > 0.06) {
      this.plumes.push({ x, y, strength: Math.min(1, strength), seed, age: 0 });
      if (this.plumes.length > INK_SOURCE_COUNT) this.plumes.shift();
    }
    this.plumes = this.plumes.filter((plume) => plume.age < INK_PLUME_SECONDS);
    this.plumes.forEach((plume, index) => {
      const from = integral(plume.age / INK_PLUME_SECONDS);
      plume.age += dt;
      const dose = (integral(plume.age / INK_PLUME_SECONDS) - from) * plume.strength * INK_DOSE;
      this.sources[index * 4] =
        plume.x + Math.sin(plume.seed * 6.28 + plume.age * 1.3) * plume.age * 0.008;
      this.sources[index * 4 + 1] = plume.y + plume.age * 0.015;
      this.sources[index * 4 + 2] = dose;
      this.sources[index * 4 + 3] = plume.seed;
    });
    return this;
  }
}

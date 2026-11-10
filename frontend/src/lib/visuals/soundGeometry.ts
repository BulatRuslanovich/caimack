// SPDX-License-Identifier: AGPL-3.0-only
import type { AudioMotionFrame } from "./audioMotion";
import { MOTION_BANDS } from "./audioMotion";

// Cubic B-splines preserve continuous curvature between frequency bands.
export function sampleBand(bands: Float32Array, x: number): number {
  const position = Math.max(0, Math.min(1, x)) * (MOTION_BANDS - 1);
  const index = Math.floor(position),
    t = position - index;
  const at = (offset: number) => bands[Math.max(0, Math.min(MOTION_BANDS - 1, index + offset))];
  return (
    (at(-1) * (1 - t) ** 3 +
      at(0) * (3 * t ** 3 - 6 * t * t + 4) +
      at(1) * (-3 * t ** 3 + 3 * t * t + 3 * t + 1) +
      at(2) * t ** 3) /
    6
  );
}

export const RIBBON_RANGES = [
  [0, 6],
  [6, 11],
  [11, 15],
  [15, 20],
  [20, 24],
] as const;

export function ribbonControls(spectrum: Float32Array): Float32Array {
  const controls = new Float32Array(20);
  RIBBON_RANGES.forEach(([from, to], line) => {
    let sum = 0,
      moment = 0;
    for (let i = from; i < to; i++) {
      sum += spectrum[i];
      moment += spectrum[i] * (i - from);
    }
    controls.set(
      [sum / (to - from), sum > 0 ? moment / sum / (to - from - 1) : 0.5, from / 23, (to - 1) / 23],
      line * 4,
    );
  });
  return controls;
}

export class RibbonWaves {
  readonly phases = new Float32Array(5);
  private speeds = new Float32Array(5);

  step(controls: Float32Array, delta: number): Float32Array {
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(delta) ? delta : 0));
    if (!dt) return this.phases;
    for (let line = 0; line < 5; line++) {
      const power = controls[line * 4],
        pitch = controls[line * 4 + 1];
      const speed = power > 0.002 ? (0.35 + pitch * 1.3 + line * 0.1) * Math.sqrt(power) : 0;
      this.speeds[line] += (speed - this.speeds[line]) * (1 - Math.exp(-dt / 0.15));
      this.phases[line] =
        (this.phases[line] + this.speeds[line] * dt * Math.PI * 2) % (Math.PI * 20);
    }
    return this.phases;
  }
}

export function auroraCentre(
  frame: Pick<AudioMotionFrame, "spectrum" | "transients" | "beatEvents">,
  x: number,
  line: number,
  controls = ribbonControls(frame.spectrum),
  phase = 0,
): number {
  const power = controls[line * 4],
    pitch = controls[line * 4 + 1];
  const from = controls[line * 4 + 2],
    to = controls[line * 4 + 3];
  const width = to - from + 1 / 23;
  let wave = 0;
  for (let i = 0; i < 8; i++) {
    const age = frame.beatEvents[i * 4];
    if (age < 0 || age >= 2.5) continue;
    const frequency = frame.beatEvents[i * 4 + 2];
    const coupling = Math.exp(-2 * ((frequency - (from + to) / 2) / width) ** 2);
    const origin = Math.max(0.12, Math.min(0.88, (frequency - from) / (to - from)));
    const left = x - origin + age * 1.5,
      right = x - origin - age * 1.5;
    wave +=
      (Math.cos(left * 15) * Math.exp(-left * left * 32) +
        Math.cos(right * 15) * Math.exp(-right * right * 32)) *
      0.5 *
      (1 - Math.exp((-age * age) / 0.0064)) *
      Math.exp(-age * 2.5) *
      frame.beatEvents[i * 4 + 1] *
      coupling;
  }
  const position = from + (to - from) * x;
  const local = sampleBand(frame.spectrum, position);
  const attack = sampleBand(frame.transients, position);
  const rest = Math.sin(x * 2.7 - 0.8) * 0.055;
  const standing =
    Math.sin(x * (1.25 + pitch * 1.5) * Math.PI * 2 - phase) +
    Math.sin(x * (2.2 + pitch) * Math.PI * 2 + phase * 0.6) * 0.25;
  const centre =
    0.5 +
    (line - 2) * 0.085 +
    rest +
    (power - 0.2) * 0.24 +
    (local - power) * 0.16 +
    attack * 0.045 +
    (0.06 * wave) / (1 + Math.abs(wave)) +
    (pitch - 0.5) * power * 0.08 * Math.sin(Math.PI * x);
  const offset = centre + standing * power ** 1.5 * 0.12 - 0.5;
  return 0.5 + (0.4 * offset) / Math.sqrt(0.16 + offset * offset);
}

export const spectrumGlsl = `
vec2 spectralLevel(float x){
 float band=clamp(x,0.,1.)*23.,left=floor(band),t=fract(band);
 vec2 a=texture2D(spectrum,vec2((left-.5)/24.,.5)).ar;
 vec2 b=texture2D(spectrum,vec2((left+.5)/24.,.5)).ar;
 vec2 c=texture2D(spectrum,vec2((left+1.5)/24.,.5)).ar;
 vec2 d=texture2D(spectrum,vec2((left+2.5)/24.,.5)).ar;
 return (a*pow(1.-t,3.)+b*(3.*t*t*t-6.*t*t+4.)+c*(-3.*t*t*t+3.*t*t+3.*t+1.)+d*t*t*t)/6.;
}`;

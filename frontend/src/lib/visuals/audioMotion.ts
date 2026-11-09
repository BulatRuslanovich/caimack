// SPDX-License-Identifier: AGPL-3.0-only

const BEATS = 8;
const SPARKS = 6;
const clamp = (value: number, max = 1) =>
  Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));
const approach = (current: number, target: number, seconds: number, delta: number) =>
  current + (target - current) * (1 - Math.exp(-delta / seconds));

interface Event {
  at: number;
  strength: number;
  seed: number;
}
export interface AudioMotionFrame {
  bass: number;
  mid: number;
  high: number;
  pulse: number;
  presence: number;
  spring: [number, number];
  beatEvents: Float32Array;
  sparkEvents: Float32Array;
  pigment: [number, number, number, number];
}

// Frequency envelopes control the material; positive spectral changes create
// discrete impulses. Running averages keep quiet recordings responsive too.
export class AudioMotion {
  private clock = 0;
  private previous = [0, 0, 0];
  private averages = [0.04, 0.04, 0.02];
  private beats: Event[] = [];
  private sparks: Event[] = [];
  private lastBeat = -1;
  private lastSpark = -1;
  private seed = 0;
  private velocity = [0, 0];
  readonly frame: AudioMotionFrame = {
    bass: 0,
    mid: 0,
    high: 0,
    pulse: 0,
    presence: 0,
    spring: [0, 0],
    beatEvents: new Float32Array(BEATS * 4).fill(-1),
    sparkEvents: new Float32Array(SPARKS * 4).fill(-1),
    pigment: [0.5, 0.5, 0, 0],
  };

  step(
    input: readonly number[],
    delta: number,
    sensitivity: number,
    active = true,
  ): AudioMotionFrame {
    if (!active) {
      this.frame.pigment[2] = 0;
      return this.frame;
    }
    const dt = Math.min(0.06, Math.max(0, Number.isFinite(delta) ? delta : 0));
    this.clock += dt;
    const gain = (clamp(sensitivity / 100) * 2) ** 1.4;
    const raw = [0, 1, 2].map((i) => clamp(input[i]));
    const rises = raw.map(
      (value, i) => Math.max(0, value - this.previous[i]) / Math.max(0.035, this.averages[i]),
    );
    raw.forEach((value, i) => {
      this.averages[i] = approach(this.averages[i], value, 3, dt);
    });
    const normalized = raw.map(
      (value, i) => (gain * value) / Math.max(0.075, this.averages[i] * 2.2),
    );
    const targets = normalized.map((value) => 1 - Math.exp(-value * 0.65));
    const f = this.frame;
    f.bass = approach(f.bass, targets[0], targets[0] > f.bass ? 0.035 : 0.22, dt);
    f.mid = approach(f.mid, targets[1], targets[1] > f.mid ? 0.12 : 0.5, dt);
    f.high = approach(f.high, targets[2], targets[2] > f.high ? 0.025 : 0.12, dt);
    f.presence = approach(f.presence, clamp((f.bass * 0.45 + f.mid * 0.55 - 0.2) * 1.7), 1.2, dt);
    const beatStrength = clamp((rises[0] * 1.3 + rises[1] * 0.22 - 0.04) * gain);
    const sparkStrength = clamp((rises[2] * 1.1 - 0.05) * gain);
    f.pigment[2] = 0;
    if (beatStrength > 0.075 && raw[0] > 0.008 && this.clock - this.lastBeat > 0.15) {
      const seed = (++this.seed * 0.61803398875) % 1;
      this.beats.unshift({ at: this.clock, strength: beatStrength, seed });
      this.beats.length = Math.min(BEATS, this.beats.length);
      this.lastBeat = this.clock;
      f.pulse = Math.max(f.pulse, beatStrength);
      this.velocity[0] += Math.cos(seed * Math.PI * 2) * beatStrength * 2.4;
      this.velocity[1] += Math.sin(seed * Math.PI * 2) * beatStrength * 1.8;
      f.pigment = [0.18 + seed * 0.64, 0.23 + ((seed * 2.7) % 1) * 0.55, beatStrength, seed];
    }
    if (sparkStrength > 0.09 && raw[2] > 0.005 && this.clock - this.lastSpark > 0.08) {
      const seed = (++this.seed * 0.38196601125) % 1;
      this.sparks.unshift({ at: this.clock, strength: sparkStrength, seed });
      this.sparks.length = Math.min(SPARKS, this.sparks.length);
      this.lastSpark = this.clock;
      if (!f.pigment[2])
        f.pigment = [0.1 + seed * 0.8, 0.2 + ((seed * 1.7) % 1) * 0.6, sparkStrength * 0.22, seed];
    }
    f.pulse = approach(f.pulse, 0, 0.18, dt);
    // A damped lens spring reacts on the attack and settles, rather than
    // continuously shaking at the volume of a sustained bass note.
    for (let axis = 0; axis < 2; axis++) {
      this.velocity[axis] += (-52 * f.spring[axis] - 9 * this.velocity[axis]) * dt;
      f.spring[axis] = Math.max(-0.4, Math.min(0.4, f.spring[axis] + this.velocity[axis] * dt));
    }
    const pack = (events: Event[], target: Float32Array) => {
      target.fill(-1);
      events.forEach((event, i) => {
        target[i * 4] = this.clock - event.at;
        target[i * 4 + 1] = event.strength;
        target[i * 4 + 2] = event.seed;
        target[i * 4 + 3] = 0;
      });
    };
    pack(this.beats, f.beatEvents);
    pack(this.sparks, f.sparkEvents);
    this.previous = raw;
    return f;
  }
}

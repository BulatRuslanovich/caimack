// SPDX-License-Identifier: AGPL-3.0-only

const BEATS = 8;
const SPARKS = 6;
export const MOTION_BANDS = 24;
const clamp = (value: number, max = 1) =>
  Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));
const approach = (current: number, target: number, seconds: number, delta: number) =>
  current + (target - current) * (1 - Math.exp(-delta / seconds));
const punch = (rise: number) => clamp((rise - 0.06) * 2.8) ** 1.5;

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
  energy: number;
  drive: number;
  spectrum: Float32Array;
  transients: Float32Array;
  spring: [number, number];
  beatEvents: Float32Array;
  sparkEvents: Float32Array;
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
  private velocity = [0, 0];
  private spectralAverage = 0.08;
  private previousSpectrum = new Float32Array(MOTION_BANDS);
  private bandAverages = new Float32Array(MOTION_BANDS).fill(0.06);
  private bandSlopes = new Float32Array(MOTION_BANDS);
  private bandAttacks = new Float32Array(MOTION_BANDS);
  private slopes = [0, 0, 0];
  private rhythm = 0;
  private loudnessPower = 0;
  private shortPower = 0;
  private referencePower = 0;
  readonly frame: AudioMotionFrame = {
    bass: 0,
    mid: 0,
    high: 0,
    pulse: 0,
    presence: 0,
    energy: 0,
    drive: 0,
    spectrum: new Float32Array(MOTION_BANDS),
    transients: new Float32Array(MOTION_BANDS),
    spring: [0, 0],
    beatEvents: new Float32Array(BEATS * 4).fill(-1),
    sparkEvents: new Float32Array(SPARKS * 4).fill(-1),
  };

  step(
    input: readonly number[],
    delta: number,
    sensitivity: number,
    active = true,
    spectrum: ArrayLike<number> = [],
    rms?: number,
  ): AudioMotionFrame {
    if (!active) return this.frame;
    const dt = Math.min(0.06, Math.max(0, Number.isFinite(delta) ? delta : 0));
    this.clock += dt;
    const gain = (clamp(sensitivity / 100) * 2) ** 1.4;
    const raw = [0, 1, 2].map((i) => clamp(input[i]));
    // Measure a change per 1/60 s, then remove the recent slope. A crescendo
    // can be loud and keep rising without being treated as repeated impacts.
    const rate = dt > 0 ? 1 / 60 / dt : 0;
    const rises = raw.map((value, i) => {
      const slope =
        (Math.max(0, value - this.previous[i]) * rate) / Math.max(0.12, this.averages[i], value);
      const attack = rate > 0 ? Math.max(0, slope - this.slopes[i] * 1.4) / rate : 0;
      this.slopes[i] = approach(this.slopes[i], slope, 0.12, dt);
      return attack;
    });
    raw.forEach((value, i) => {
      this.averages[i] = approach(this.averages[i], value, 3, dt);
    });
    const normalized = raw.map(
      (value, i) => (gain * value) / Math.max(0.075, this.averages[i] * 2.2),
    );
    const targets = normalized.map((value) => 1 - Math.exp(-value * 0.65));
    const f = this.frame;
    // FFT levels are relative and logarithmic: a quiet piano note can occupy
    // as much of the normalized spectrum as a loud drum. Preserve physical
    // amplitude separately so automatic spectral gain cannot amplify motion.
    let amplitude = 1;
    let accent = 0;
    if (rms !== undefined) {
      const level = clamp(rms);
      const before = Math.sqrt(this.shortPower);
      const reference = Math.sqrt(this.referencePower);
      this.shortPower = approach(this.shortPower, level * level, 0.025, dt);
      const fast = Math.sqrt(this.shortPower);
      const contrast = clamp((fast - reference * 1.18 - 0.0015) / Math.max(0.009, reference * 1.5));
      const edge = clamp(((fast - before) * rate) / Math.max(0.0025, reference * 0.12));
      accent = contrast * edge;
      this.referencePower = approach(this.referencePower, level * level, 0.45, dt);
      this.loudnessPower = approach(
        this.loudnessPower,
        level * level,
        level * level > this.loudnessPower ? 1.6 : 2.4,
        dt,
      );
      const weight = clamp((Math.sqrt(this.loudnessPower) - 0.025) / 0.255);
      amplitude = 0.06 + 0.94 * weight * weight * (3 - 2 * weight);
    }
    // Share gain across the spectrum: normalizing each band independently
    // would make a quiet overtone as large as the note that produced it.
    let peak = 0;
    for (let i = 0; i < MOTION_BANDS; i++) peak = Math.max(peak, clamp(spectrum[i]));
    this.spectralAverage = approach(this.spectralAverage, peak, 3, dt);
    let bassFlux = 0,
      bodyFlux = 0;
    let attackWeight = 0,
      attackMoment = 0,
      trebleWeight = 0,
      trebleMoment = 0;
    for (let i = 0; i < MOTION_BANDS; i++) {
      const value = Math.max(0, clamp(spectrum[i]) - 0.002);
      const slope =
        (Math.max(0, value - this.previousSpectrum[i] - 0.004) * rate) /
        Math.max(0.12, this.bandAverages[i], value);
      const rise = rate > 0 ? Math.max(0, slope - this.bandSlopes[i] * 1.4) / rate : 0;
      this.bandSlopes[i] = approach(this.bandSlopes[i], slope, 0.12, dt);
      this.bandAttacks[i] = punch(rise * 1.8) * gain;
      attackWeight += this.bandAttacks[i];
      attackMoment += (this.bandAttacks[i] * i) / (MOTION_BANDS - 1);
      if (i >= 18) {
        trebleWeight += value;
        trebleMoment += (value * i) / (MOTION_BANDS - 1);
      }
      if (i < 9) bassFlux += rise / 9;
      else if (i < 18) bodyFlux += rise / 9;
      this.previousSpectrum[i] = value;
      this.bandAverages[i] = approach(this.bandAverages[i], value, 0.7, dt);
    }
    const novelty = Math.max(rises[0] * 1.3 + rises[1] * 0.75, bassFlux * 4 + bodyFlux * 3);
    const candidate = clamp(Math.max(punch(novelty), accent * 0.8) * gain);
    this.rhythm = approach(this.rhythm, 0, 0.8, dt);
    const beat =
      candidate > 0.12 && (raw[0] > 0.008 || raw[1] > 0.012) && this.clock - this.lastBeat > 0.09;
    if (beat) this.rhythm = clamp(this.rhythm + 0.22 + candidate * 0.08);
    const drive = clamp((this.rhythm - 0.28) / 0.72) ** 1.5 * amplitude;
    f.drive = approach(f.drive, drive, drive > f.drive ? 0.12 : 1.6, dt);
    const impact = Math.max((0.18 + 0.82 * Math.max(drive, f.drive)) * amplitude, accent * 0.45);
    for (let i = 0; i < MOTION_BANDS; i++) {
      const value = Math.max(0, clamp(spectrum[i]) - 0.002);
      const transient = clamp(this.bandAttacks[i] * impact);
      f.transients[i] = approach(
        f.transients[i],
        transient,
        transient > f.transients[i] ? 0.065 - f.drive * 0.053 : 0.085,
        dt,
      );
      const target =
        (1 - Math.exp((-value * gain * 0.8) / Math.max(0.06, this.spectralAverage, peak * 0.5))) *
        (0.3 + 0.7 * amplitude);
      const attack = 0.18 - f.drive * 0.16;
      f.spectrum[i] = approach(
        f.spectrum[i],
        target,
        target > f.spectrum[i] ? attack : 0.3 - f.drive * 0.16,
        dt,
      );
    }
    const energy = Math.max(...raw, peak);
    const activity = 1 - Math.exp(-Math.max(0, energy - 0.002) * gain * 8);
    f.energy = approach(f.energy, activity, activity > f.energy ? 0.08 : 0.65, dt);
    f.bass = approach(f.bass, targets[0], targets[0] > f.bass ? 0.035 : 0.22, dt);
    f.mid = approach(f.mid, targets[1], targets[1] > f.mid ? 0.12 : 0.5, dt);
    f.high = approach(f.high, targets[2], targets[2] > f.high ? 0.025 : 0.12, dt);
    f.presence = approach(f.presence, clamp((f.bass * 0.45 + f.mid * 0.55 - 0.2) * 1.7), 1.2, dt);
    // Positive changes in narrow bands reveal kick/snare attacks even when
    // distorted guitars keep the total bass and mid energy nearly constant.
    const beatStrength = candidate * impact;
    const sparkStrength = clamp(punch(rises[2] * 1.1) * gain) * impact;
    if (beat) {
      const seed = attackWeight > 0 ? attackMoment / attackWeight : 0.5;
      this.beats.unshift({ at: this.clock, strength: beatStrength, seed });
      this.beats.length = Math.min(BEATS, this.beats.length);
      this.lastBeat = this.clock;
      f.pulse = Math.max(f.pulse, beatStrength);
      this.velocity[0] += Math.cos(seed * Math.PI * 2) * beatStrength * 2.4;
      this.velocity[1] += Math.sin(seed * Math.PI * 2) * beatStrength * 1.8;
    }
    if (sparkStrength > 0.09 && raw[2] > 0.005 && this.clock - this.lastSpark > 0.08) {
      const seed = trebleWeight > 0 ? trebleMoment / trebleWeight : 0.85;
      this.sparks.unshift({ at: this.clock, strength: sparkStrength, seed });
      this.sparks.length = Math.min(SPARKS, this.sparks.length);
      this.lastSpark = this.clock;
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

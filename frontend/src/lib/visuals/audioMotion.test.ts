// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { AudioMotion, MOTION_BANDS } from "./audioMotion";

describe("music-driven material motion", () => {
  it("shows a strong isolated accent on a quiet background without increasing continuous motion", () => {
    const motion = new AudioMotion();
    const spectrum = new Float32Array(MOTION_BANDS).fill(0.15);
    for (let i = 0; i < 120; i++)
      motion.step([0.15, 0.15, 0.03], 1 / 30, 65, true, spectrum, 0.012);
    // A narrow saturated FFT peak can hide an amplitude jump. Time-domain
    // contrast must still produce a visible impulse without boosting drive.
    const hit = motion.step([0.15, 0.15, 0.03], 1 / 30, 65, true, spectrum, 0.08);
    expect(hit.beatEvents[0]).toBe(0);
    expect(hit.beatEvents[1]).toBeGreaterThan(0.2);
    expect(hit.drive).toBeLessThan(0.1);
  });
  it("does not confuse a slow change in measured amplitude with repeated accents", () => {
    const motion = new AudioMotion();
    const spectrum = new Float32Array(MOTION_BANDS).fill(0.15);
    for (let i = 0; i < 300; i++)
      motion.step([0.15, 0.15, 0.03], 1 / 30, 65, true, spectrum, 0.01 + i / 3000);
    expect(motion.frame.beatEvents[0]).toBeGreaterThan(8);
    expect(motion.frame.pulse).toBeLessThan(0.001);
  });
  it("places wave sources according to the attacking frequencies", () => {
    const low = new Float32Array(MOTION_BANDS),
      middle = new Float32Array(MOTION_BANDS);
    low[3] = 0.5;
    middle[15] = 0.5;
    const bass = new AudioMotion().step([0.4, 0.4, 0], 1 / 30, 65, true, low);
    const voice = new AudioMotion().step([0.4, 0.4, 0], 1 / 30, 65, true, middle);
    expect(bass.beatEvents[2]).toBeCloseTo(3 / 23);
    expect(voice.beatEvents[2]).toBeCloseTo(15 / 23);
  });
  it("does not let normalized FFT attacks give quiet music the force of loud drums", () => {
    const play = (loud: boolean) => {
      const motion = new AudioMotion();
      const bands = new Float32Array(MOTION_BANDS);
      let total = 0;
      for (let i = 0; i < 900; i++) {
        const age = (i % 7) / 60;
        bands.fill(0.2);
        bands.fill(0.2 + 0.035 * Math.exp(-age / 0.025), 2, 6);
        // Same relative spectrum and onsets. Quiet music also has occasional
        // short peaks, which must not instantly change the material's character.
        const rms = loud ? 0.27 : 0.04 + (i % 90 === 0 ? 0.27 : 0);
        const frame = motion.step([0.4, 0.4, 0.2], 1 / 60, 65, true, bands, rms);
        if (i > 300) total += frame.pulse;
      }
      return { total, drive: motion.frame.drive, spectrum: Math.max(...motion.frame.spectrum) };
    };
    const quiet = play(false),
      loud = play(true);
    expect(loud.total).toBeGreaterThan(quiet.total * 5);
    expect(quiet.drive).toBeLessThan(0.15);
    expect(loud.drive).toBeGreaterThan(0.7);
    expect(quiet.spectrum).toBeGreaterThan(0.05);
  });
  it("keeps sparse notes calm while building drive for a rapid drum pattern at the same volume", () => {
    const play = (period: number) => {
      const motion = new AudioMotion();
      const bands = new Float32Array(MOTION_BANDS);
      let drive = 0,
        peak = 0,
        count = 0;
      for (let i = 0; i < 720; i++) {
        const age = (i / 60) % period;
        const fade = Math.min(1, i / 120);
        bands.fill(0.2 * fade);
        const from = Math.floor(i / 60 / period) % 2 ? 11 : 2;
        for (let j = from; j < from + 4; j++) bands[j] += 0.035 * fade * Math.exp(-age / 0.035);
        const frame = motion.step([0.4 * fade, 0.4 * fade, 0.2 * fade], 1 / 60, 65, true, bands);
        if (i > 240) {
          drive += frame.drive;
          peak = Math.max(peak, frame.pulse);
          count++;
        }
      }
      return { drive: drive / count, peak, motion };
    };
    const sparse = play(1.5),
      rapid = play(7 / 60);
    expect(sparse.drive).toBeLessThan(0.15);
    expect(rapid.drive).toBeGreaterThan(0.4);
    expect(rapid.peak).toBeGreaterThan(sparse.peak * 2);
    expect(Math.max(...sparse.motion.frame.spectrum)).toBeGreaterThan(0.2);
    for (let i = 0; i < 420; i++)
      rapid.motion.step(
        [0.4, 0.4, 0.2],
        1 / 60,
        65,
        true,
        new Float32Array(MOTION_BANDS).fill(0.2),
      );
    expect(rapid.motion.frame.drive).toBeLessThan(0.1);
  });
  it("does not mistake a smooth loud crescendo for a drum roll", () => {
    const motion = new AudioMotion();
    const bands = new Float32Array(MOTION_BANDS);
    let strongest = 0;
    for (let i = 0; i < 600; i++) {
      const level = (0.4 * i) / 600;
      bands.fill(level);
      const frame = motion.step([level, level, level], 1 / 60, 65, true, bands);
      strongest = Math.max(strongest, frame.pulse, ...frame.transients);
    }
    expect(strongest).toBeLessThan(0.05);
    expect(motion.frame.drive).toBeLessThan(0.01);
    expect(motion.frame.energy).toBeGreaterThan(0.8);
  });
  it.each([30, 60])(
    "separates kick and snare attacks from a loud sustained background at %i fps",
    (fps) => {
      const motion = new AudioMotion();
      const bands = new Float32Array(MOTION_BANDS).fill(0.2);
      for (let i = 0; i < fps * 4; i++) motion.step([0.4, 0.4, 0.2], 1 / fps, 65, true, bands);
      let detected = 0;
      let firstPulse = 0;
      let lastPulse = 0;
      for (let hit = 0; hit < 16; hit++) {
        // Overall bass/mid energy stays fixed: guitars mask a small drum attack.
        const from = hit % 2 ? 11 : 2;
        for (let i = from; i < from + 4; i++) bands[i] = 0.235;
        const frame = motion.step([0.4, 0.4, 0.2], 1 / fps, 65, true, bands);
        if (frame.beatEvents[0] === 0) detected++;
        if (hit === 0) firstPulse = frame.pulse;
        lastPulse = frame.pulse;
        expect(frame.pulse).toBeGreaterThan(0.04);
        expect(frame.transients[from]).toBeGreaterThan(0);
        bands.fill(0.2);
        for (let i = 0; i < 6; i++) motion.step([0.4, 0.4, 0.2], 1 / fps, 65, true, bands);
      }
      expect(detected).toBe(16);
      expect(lastPulse).toBeGreaterThan(firstPulse * 2);
      expect(motion.frame.drive).toBeGreaterThan(0.35);
    },
  );
  it("does not turn small fluctuations in sustained loud sound into drum hits", () => {
    const motion = new AudioMotion();
    const bands = new Float32Array(MOTION_BANDS).fill(0.3);
    for (let i = 0; i < 240; i++) {
      bands.fill(0.3 + Math.sin(i * 2) * 0.001);
      motion.step([0.4, 0.4, 0.2], 1 / 60, 65, true, bands);
    }
    expect(motion.frame.beatEvents[4]).toBe(-1);
    expect(motion.frame.pulse).toBeLessThan(0.0001);
  });
  it("keeps notes in their spectral positions instead of reducing them to volume", () => {
    const bands = new Float32Array(MOTION_BANDS);
    bands[5] = 0.4;
    bands[6] = 0.04;
    const low = new AudioMotion().step([0, 0.2, 0], 1 / 30, 65, true, bands);
    bands.fill(0);
    bands[17] = 0.4;
    const high = new AudioMotion().step([0, 0.2, 0], 1 / 30, 65, true, bands);
    expect(low.spectrum[5]).toBeGreaterThan(low.spectrum[6] * 3);
    expect(low.spectrum[17]).toBe(0);
    expect(high.spectrum[5]).toBe(0);
    expect(high.spectrum[17]).toBeCloseTo(low.spectrum[5]);
  });
  it("attacks quickly, leaves a short spectral trail, then settles in silence", () => {
    const motion = new AudioMotion();
    const bands = new Float32Array(MOTION_BANDS).fill(0.2);
    for (let i = 0; i < 30; i++) motion.step([0.2, 0.2, 0.2], 1 / 30, 65, true, bands);
    const peak = motion.frame.spectrum[8];
    bands.fill(0);
    motion.step([0, 0, 0], 1 / 30, 65, true, bands);
    expect(motion.frame.spectrum[8]).toBeGreaterThan(peak * 0.7);
    for (let i = 0; i < 300; i++) motion.step([0, 0, 0], 1 / 30, 65, true, bands);
    expect(motion.frame.energy).toBeLessThan(0.00001);
    expect(Math.max(...motion.frame.spectrum)).toBeLessThan(0.00001);
  });
  it("keeps quiet music responsive without amplifying the noise floor", () => {
    const quiet = new AudioMotion();
    const bands = new Float32Array(MOTION_BANDS).fill(0.02);
    for (let i = 0; i < 240; i++) quiet.step([0.02, 0.02, 0.02], 1 / 30, 65, true, bands);
    expect(quiet.frame.spectrum[0]).toBeGreaterThan(0.2);
    const noise = new AudioMotion().step(
      [0.001, 0.001, 0.001],
      1 / 30,
      65,
      true,
      new Float32Array(MOTION_BANDS).fill(0.001),
    );
    expect(noise.energy).toBe(0);
    expect(Math.max(...noise.spectrum)).toBe(0);
  });
  it("freezes the spectrum on pause and respects zero sensitivity", () => {
    const bands = new Float32Array(MOTION_BANDS).fill(0.4);
    const motion = new AudioMotion();
    const frame = motion.step([0.4, 0.2, 0.2], 1 / 30, 65, true, bands);
    const before = {
      spectrum: [...frame.spectrum],
      transients: [...frame.transients],
      energy: frame.energy,
    };
    motion.step([0, 0, 0], 1, 65, false);
    expect([...frame.spectrum]).toEqual(before.spectrum);
    expect(frame.energy).toBe(before.energy);
    expect([...frame.transients]).toEqual(before.transients);
    const zero = new AudioMotion().step([0.4, 0.2, 0.2], 1 / 30, 0, true, bands);
    expect(zero.energy).toBe(0);
    expect(Math.max(...zero.spectrum)).toBe(0);
    expect(Math.max(...zero.transients)).toBe(0);
  });
  it("turns bass attacks into traveling events, a lens impulse", () => {
    const motion = new AudioMotion();
    for (let i = 0; i < 20; i++) motion.step([0, 0, 0], 1 / 30, 65);
    const hit = motion.step([0.5, 0.2, 0.04], 1 / 30, 65);
    expect(hit.beatEvents[0]).toBe(0);
    expect(hit.beatEvents[1]).toBeGreaterThan(0.1);
    expect(Math.hypot(...hit.spring)).toBeGreaterThan(0);
  });
  it("does not invent repeated drum hits from sustained sound", () => {
    const motion = new AudioMotion();
    for (let i = 0; i < 100; i++) motion.step([0.3, 0.3, 0.1], 1 / 30, 65);
    const frame = motion.frame;
    expect(frame.beatEvents[4]).toBe(-1);
    expect(frame.beatEvents[0]).toBeGreaterThan(3);
  });
  it("separates high-frequency spark attacks from bass impulses", () => {
    const motion = new AudioMotion();
    const hit = motion.step([0, 0, 0.4], 1 / 30, 65);
    expect(hit.beatEvents[0]).toBe(-1);
    expect(hit.sparkEvents[0]).toBe(0);
    expect(hit.high).toBeGreaterThan(0);
  });
  it("lets sensitivity disable or strengthen musical responses without changing opacity", () => {
    const zero = new AudioMotion().step([0.4, 0.3, 0.2], 1 / 30, 0);
    const low = new AudioMotion().step([0.4, 0.3, 0.2], 1 / 30, 20);
    const high = new AudioMotion().step([0.4, 0.3, 0.2], 1 / 30, 100);
    expect(zero.bass + zero.mid + zero.high + zero.pulse).toBe(0);
    expect(zero.beatEvents[0]).toBe(-1);
    expect(high.bass).toBeGreaterThan(low.bass);
    expect(high.mid).toBeGreaterThan(low.mid);
  });
  it("preserves phase, spring and events on pause", () => {
    const motion = new AudioMotion();
    const frame = motion.step([0.4, 0.2, 0.2], 1 / 30, 65);
    const before = { age: frame.beatEvents[0], spring: [...frame.spring], bass: frame.bass };
    const paused = motion.step([0, 0, 0], 10, 65, false);
    expect(paused.beatEvents[0]).toBe(before.age);
    expect(paused.spring).toEqual(before.spring);
    expect(paused.bass).toBe(before.bass);
  });
  it("bounds history and settles the spring after repeated beats and silence", () => {
    const motion = new AudioMotion();
    for (let beat = 0; beat < 100; beat++) {
      motion.step([0.6, 0.3, 0.3], 1 / 30, 100);
      for (let i = 0; i < 10; i++) motion.step([0, 0, 0], 1 / 30, 100);
    }
    expect(motion.frame.beatEvents.length).toBe(32);
    expect(motion.frame.sparkEvents.length).toBe(24);
    for (let i = 0; i < 300; i++) motion.step([0, 0, 0], 1 / 30, 100);
    expect(Math.hypot(...motion.frame.spring)).toBeLessThan(0.00001);
    expect(
      [
        motion.frame.bass,
        motion.frame.mid,
        motion.frame.high,
        motion.frame.pulse,
        ...motion.frame.spring,
      ].every(Number.isFinite),
    ).toBe(true);
  });
});

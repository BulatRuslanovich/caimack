// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { AudioMotion, MOTION_BANDS } from "./audioMotion";
import { auroraCentre, ribbonControls, RibbonWaves, sampleBand } from "./soundGeometry";

describe("sound-driven continuous surfaces", () => {
  it("keeps a sustained note waving in its own ribbon while silent registers stay still", () => {
    const frame = new AudioMotion().frame;
    frame.spectrum.fill(0.6, 11, 15);
    const controls = ribbonControls(frame.spectrum),
      waves = new RibbonWaves();
    const before = auroraCentre(frame, 0.31, 2, controls, 0);
    for (let i = 0; i < 45; i++) waves.step(controls, 1 / 30);
    expect(waves.phases[2]).toBeGreaterThan(1);
    expect(waves.phases[0]).toBe(0);
    expect(waves.phases[4]).toBe(0);
    expect(
      Math.abs(auroraCentre(frame, 0.31, 2, controls, waves.phases[2]) - before),
    ).toBeGreaterThan(0.015);
    const paused = [...waves.phases];
    waves.step(controls, 0);
    expect([...waves.phases]).toEqual(paused);
    frame.spectrum.fill(0);
    const silent = ribbonControls(frame.spectrum);
    expect(auroraCentre(frame, 0.31, 2, silent, 0)).toBe(auroraCentre(frame, 0.31, 2, silent, 10));
  });
  it("changes wavelength and speed with pitch at the same energy", () => {
    const low = new Float32Array(MOTION_BANDS),
      high = new Float32Array(MOTION_BANDS);
    low[11] = 0.8;
    high[14] = 0.8;
    const lowControls = ribbonControls(low),
      highControls = ribbonControls(high);
    expect(lowControls[8]).toBe(highControls[8]);
    const lower = new RibbonWaves(),
      upper = new RibbonWaves();
    for (let i = 0; i < 30; i++) {
      lower.step(lowControls, 1 / 30);
      upper.step(highControls, 1 / 30);
    }
    expect(upper.phases[2]).toBeGreaterThan(lower.phases[2] * 2);
  });
  it("keeps independent ribbons inside the canvas under extreme spectral and beat changes", () => {
    const frame = new AudioMotion().frame;
    for (let phase = 0; phase < 30; phase++) {
      for (let band = 0; band < MOTION_BANDS; band++) {
        frame.spectrum[band] = (Math.sin(band * 1.7 + phase) + 1) / 2;
        frame.transients[band] = (phase + band) % 3 === 0 ? 1 : 0;
      }
      for (let event = 0; event < 8; event++) {
        frame.beatEvents.set([phase / 30 + event * 0.1, 1, event / 7, 0], event * 4);
      }
      for (let step = 0; step <= 100; step++) {
        const centres = Array.from({ length: 5 }, (_, line) =>
          auroraCentre(frame, step / 100, line),
        );
        expect(Math.min(...centres)).toBeGreaterThan(0.1);
        expect(Math.max(...centres)).toBeLessThan(0.9);
      }
    }
  });
  it("makes each ribbon follow its own register and allows sound-driven crossings", () => {
    const low = new AudioMotion().frame,
      high = new AudioMotion().frame;
    low.spectrum.fill(0.8, 0, 6);
    high.spectrum.fill(0.8, 20, 24);
    expect(auroraCentre(low, 0.5, 0) - auroraCentre(high, 0.5, 0)).toBeGreaterThan(0.1);
    expect(auroraCentre(high, 0.5, 4) - auroraCentre(low, 0.5, 4)).toBeGreaterThan(0.1);
    expect(auroraCentre(low, 0.5, 2)).toBeCloseTo(auroraCentre(high, 0.5, 2), 6);
    expect(auroraCentre(low, 0.5, 0)).toBeGreaterThan(auroraCentre(low, 0.5, 1));
  });
  it("does not introduce corners between frequency bands or at a wave's source", () => {
    const frame = new AudioMotion().frame;
    for (let i = 0; i < MOTION_BANDS; i++) frame.spectrum[i] = i % 2;
    const epsilon = 0.00001;
    for (let i = 1; i < MOTION_BANDS - 1; i++) {
      const x = i / 23;
      const left =
        (sampleBand(frame.spectrum, x) - sampleBand(frame.spectrum, x - epsilon)) / epsilon;
      const right =
        (sampleBand(frame.spectrum, x + epsilon) - sampleBand(frame.spectrum, x)) / epsilon;
      expect(Math.abs(left - right)).toBeLessThan(0.015);
    }
    frame.spectrum.fill(0.2);
    const before = auroraCentre(frame, 0.5, 2);
    frame.beatEvents.set([0, 1, 0.5, 0]);
    expect(auroraCentre(frame, 0.5, 2)).toBe(before);
    frame.beatEvents[0] = 0.15;
    const left = (auroraCentre(frame, 0.5, 2) - auroraCentre(frame, 0.5 - epsilon, 2)) / epsilon;
    const right = (auroraCentre(frame, 0.5 + epsilon, 2) - auroraCentre(frame, 0.5, 2)) / epsilon;
    expect(Math.abs(left - right)).toBeLessThan(0.01);
  });
});

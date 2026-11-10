// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { InkFlow, INK_DOSE, INK_SOURCE_COUNT } from "./inkFlow";
const idle = {
  bass: 0,
  mid: 0,
  high: 0,
  pigment: [0.5, 0.5, 0, 0.3] as [number, number, number, number],
};
const hit = {
  bass: 1,
  mid: 1,
  high: 1,
  pigment: [0.5, 0.5, 1, 0.3] as [number, number, number, number],
};

describe("smooth ink emitters", () => {
  it("lets each pair of frequency bands move its own current", () => {
    for (let band = 0; band < INK_SOURCE_COUNT; band++) {
      const ink = new InkFlow();
      const spectrum = new Float32Array(24);
      spectrum.fill(0.6, band * 2, band * 2 + 2);
      for (let i = 0; i < 60; i++) ink.step({ ...idle, spectrum, drive: 0.6 }, 1 / 30);
      expect(ink.levels[band]).toBeGreaterThan(0.3);
      for (let i = 0; i < INK_SOURCE_COUNT; i++)
        if (i !== band) expect(Math.abs(ink.currents[i * 4 + 2])).toBe(0);
    }
  });
  it("conserves a spectral jet's pigment across frame rates and pause", () => {
    for (const fps of [15, 30, 60]) {
      const ink = new InkFlow();
      const spectrum = new Float32Array(24).fill(0.2),
        transients = new Float32Array(24);
      transients.fill(0.8, 4, 6);
      let dose = 0;
      for (let i = 0; i < fps * 8; i++) {
        const frame = {
          ...idle,
          spectrum,
          transients,
          pigment: i === 0 ? hit.pigment : idle.pigment,
        };
        if (i !== 0) transients.fill(0);
        ink.step(frame, 1 / fps);
        dose += ink.sources[2 * 4 + 2];
        if (i === 3) {
          const currents = [...ink.currents];
          ink.step(frame, 0);
          expect([...ink.currents]).toEqual(currents);
          expect(ink.sources[2 * 4 + 2]).toBe(0);
        }
      }
      expect(dose).toBeCloseTo(INK_DOSE, 5);
    }
  });
  it("emits a high-frequency detail without requiring a global bass hit", () => {
    const ink = new InkFlow(),
      spectrum = new Float32Array(24).fill(0.2),
      transients = new Float32Array(24);
    transients.fill(0.3, 22, 24);
    ink.step({ ...idle, spectrum, transients }, 1 / 30);
    expect(ink.sources[11 * 4 + 2]).toBeGreaterThan(0);
    expect(Array.from({ length: 11 }, (_, i) => ink.sources[i * 4 + 2])).toEqual(
      new Array(11).fill(0),
    );
  });
  it("introduces a plume gradually, without putting a whole dense patch into one frame", () => {
    const ink = new InkFlow();
    const first = ink.step(hit, 1 / 30).sources[2];
    expect(first).toBeLessThan(0.001);
    let peak = first;
    for (let i = 0; i < 40; i++) peak = Math.max(peak, ink.step(idle, 1 / 30).sources[2]);
    expect(peak).toBeGreaterThan(first);
    expect(peak).toBeLessThan(0.06);
    expect(ink.sources[2]).toBe(0);
  });
  it("preserves the pigment dose across 15, 30 and 60 fps", () => {
    for (const fps of [15, 30, 60]) {
      const ink = new InkFlow();
      let dose = ink.step(hit, 1 / fps).sources[2];
      for (let i = 0; i < fps * 2; i++) dose += ink.step(idle, 1 / fps).sources[2];
      expect(dose).toBeCloseTo(INK_DOSE, 6);
    }
  });
  it("keeps a plume at its birthplace when another beat arrives elsewhere", () => {
    const ink = new InkFlow();
    ink.step(hit, 1 / 30);
    const oldX = ink.sources[0];
    ink.step({ ...hit, pigment: [0.1, 0.2, 0.5, 0.8] }, 1 / 30);
    expect(ink.sources[0]).toBeCloseTo(oldX, 2);
    expect(ink.sources[4]).toBeCloseTo(0.1, 2);
  });
  it("smooths frequency changes and freezes them on pause", () => {
    const ink = new InkFlow();
    ink.step(hit, 1 / 30);
    expect(ink.motion.every((level) => level > 0 && level < 0.1)).toBe(true);
    const before = [...ink.motion];
    ink.step(idle, 0);
    expect(ink.motion).toEqual(before);
    expect(ink.sources.every((value) => value === 0)).toBe(true);
  });
  it("bounds simultaneous emitters under rapid percussion", () => {
    const ink = new InkFlow();
    for (let i = 0; i < 100; i++) ink.step(hit, 1 / 60);
    expect(ink.sources.length).toBe(INK_SOURCE_COUNT * 4);
    expect(ink.sources.every(Number.isFinite)).toBe(true);
  });
  it("releases energetic plumes sooner while preserving their total pigment dose", () => {
    const release = (drive: number) => {
      const ink = new InkFlow();
      let dose = 0,
        deliveredEarly = 0;
      for (let i = 0; i < 120; i++) {
        const frame = i === 0 ? hit : idle;
        const amount = ink.step({ ...frame, drive }, 1 / 60).sources[2];
        dose += amount;
        if (i < 24) deliveredEarly += amount;
      }
      return { dose, deliveredEarly };
    };
    const soft = release(0),
      hard = release(1);
    expect(soft.dose).toBeCloseTo(INK_DOSE, 6);
    expect(hard.dose).toBeCloseTo(INK_DOSE, 6);
    expect(hard.deliveredEarly).toBeGreaterThan(soft.deliveredEarly * 3);
  });
  it("keeps quiet recordings gentle even when normalized band energy is high", () => {
    const quiet = new InkFlow(),
      loud = new InkFlow();
    for (let i = 0; i < 120; i++) {
      quiet.step(
        {
          ...idle,
          bass: 0.5,
          mid: 0.5,
          high: 0.5,
          drive: 0.1,
          spectrum: new Float32Array(24).fill(0.15),
        },
        1 / 30,
      );
      loud.step(
        {
          ...idle,
          bass: 0.5,
          mid: 0.5,
          high: 0.5,
          drive: 0.9,
          spectrum: new Float32Array(24).fill(0.6),
        },
        1 / 30,
      );
    }
    expect(loud.motion[0]).toBeGreaterThan(quiet.motion[0] * 5);
    for (let i = 0; i < 180; i++)
      quiet.step({ ...idle, drive: 0, spectrum: new Float32Array(24) }, 1 / 30);
    expect(Math.max(...quiet.motion)).toBeLessThan(0.001);
  });
});

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
});

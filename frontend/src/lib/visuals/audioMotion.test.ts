// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { AudioMotion } from "./audioMotion";

describe("music-driven material motion", () => {
  it("turns bass attacks into traveling events, a lens impulse and new pigment", () => {
    const motion = new AudioMotion();
    for (let i = 0; i < 20; i++) motion.step([0, 0, 0], 1 / 30, 65);
    const hit = motion.step([0.5, 0.2, 0.04], 1 / 30, 65);
    expect(hit.beatEvents[0]).toBe(0);
    expect(hit.beatEvents[1]).toBeGreaterThan(0.1);
    expect(hit.pigment[2]).toBeGreaterThan(0.1);
    expect(Math.hypot(...hit.spring)).toBeGreaterThan(0);
  });
  it("does not invent repeated drum hits from sustained sound", () => {
    const motion = new AudioMotion();
    for (let i = 0; i < 100; i++) motion.step([0.3, 0.3, 0.1], 1 / 30, 65);
    const frame = motion.frame;
    expect(frame.beatEvents[4]).toBe(-1);
    expect(frame.beatEvents[0]).toBeGreaterThan(3);
    expect(frame.pigment[2]).toBe(0);
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
  it("preserves phase, spring and events on pause while preventing another pigment injection", () => {
    const motion = new AudioMotion();
    const frame = motion.step([0.4, 0.2, 0.2], 1 / 30, 65);
    const before = { age: frame.beatEvents[0], spring: [...frame.spring], bass: frame.bass };
    const paused = motion.step([0, 0, 0], 10, 65, false);
    expect(paused.beatEvents[0]).toBe(before.age);
    expect(paused.spring).toEqual(before.spring);
    expect(paused.bass).toBe(before.bass);
    expect(paused.pigment[2]).toBe(0);
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

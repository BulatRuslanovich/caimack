// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { busiestDay, daypartOf, dominantDaypart, intensity, leadingBlanks } from "./recap";

describe("recap", () => {
  it("splits the day into four parts", () => {
    expect([4, 5, 10, 11, 16, 17, 22, 23].map(daypartOf)).toEqual([
      "night",
      "morning",
      "morning",
      "day",
      "day",
      "evening",
      "evening",
      "night",
    ]);
  });

  it("finds when most of the listening happened", () => {
    const hours = Array<number>(24).fill(0);
    hours[8] = 600;
    hours[21] = 400;
    hours[22] = 400;

    expect(dominantDaypart(hours)?.daypart).toBe("evening");
    expect(dominantDaypart(Array<number>(24).fill(0))).toBeNull();
  });

  it("picks the earliest of equally busy days", () => {
    expect(busiestDay([0, 300, 900, 900])).toEqual({ day: 3, seconds: 900 });
    expect(busiestDay([0, 0])).toBeNull();
  });

  it("starts weeks on Monday", () => {
    expect(leadingBlanks(2026, 9)).toBe(1);
    expect(leadingBlanks(2026, 2)).toBe(6);
  });

  it("lifts quiet days without flattening the busiest", () => {
    expect(intensity(0, 100)).toBe(0);
    expect(intensity(100, 100)).toBe(1);
    expect(intensity(25, 100)).toBe(0.5);
  });

  it("tells what share of the music fell into a part of the day", () => {
    const hours = Array<number>(24).fill(0);
    hours[23] = 300;
    hours[2] = 300;
    hours[12] = 400;

    expect(dominantDaypart(hours)).toEqual({ daypart: "night", share: 0.6 });
  });
});

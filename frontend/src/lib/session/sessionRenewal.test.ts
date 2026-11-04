// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { renewalIntervalMs } from "./sessionRenewal";

describe("renewalIntervalMs", () => {
  it("renews well before the token expires", () => {
    const lifetime = 10 * 60_000;

    expect(renewalIntervalMs(10)).toBeLessThan(lifetime);
    expect(renewalIntervalMs(10)).toBe(400_000);
  });

  it("does not renew more often than every half minute", () => {
    expect(renewalIntervalMs(0.1)).toBe(30_000);
  });

  it("falls back to the shortest interval on a nonsense lifetime", () => {
    for (const lifetime of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(renewalIntervalMs(lifetime)).toBe(30_000);
    }
  });

  it("caps the interval so a huge lifetime still renews within the hour", () => {
    expect(renewalIntervalMs(24 * 60)).toBe(60 * 60_000);
  });
});

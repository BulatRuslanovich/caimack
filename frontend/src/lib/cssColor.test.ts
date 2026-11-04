// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { rgba, rgbOf } from "@/lib/cssColor";

describe("rgbOf", () => {
  it("reads hex and rgb() colours", () => {
    expect(rgbOf("#d9a441")).toEqual([217, 164, 65]);
    expect(rgbOf(" #fff ")).toEqual([255, 255, 255]);
    expect(rgbOf("rgb(1 2 3 / 50%)")).toEqual([1, 2, 3]);
  });

  it("falls back on anything else", () => {
    expect(rgbOf("oklch(0.7 0.1 80)", [9, 9, 9])).toEqual([9, 9, 9]);
  });
});

describe("rgba", () => {
  it("clamps the alpha", () => {
    expect(rgba([1, 2, 3], 2)).toBe("rgba(1, 2, 3, 1.000)");
  });
});

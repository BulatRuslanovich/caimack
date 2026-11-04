// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { wrapLines } from "@/lib/shareCard";

const measure = (text: string) => text.length * 10;

describe("wrapLines", () => {
  it("keeps a short text on one line", () => {
    expect(wrapLines(measure, "Love Me Again", 200, 2)).toEqual(["Love Me Again"]);
  });

  it("breaks between words", () => {
    expect(wrapLines(measure, "one two three four", 90, 3)).toEqual(["one two", "three", "four"]);
  });

  it("ends the last allowed line with an ellipsis", () => {
    const lines = wrapLines(measure, "one two three four five six", 90, 2);

    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    expect(measure(lines[1])).toBeLessThanOrEqual(90);
  });

  it("puts a word wider than the line on its own", () => {
    expect(wrapLines(measure, "supercalifragilistic word", 100, 3)).toEqual([
      "supercalifragilistic",
      "word",
    ]);
  });
});

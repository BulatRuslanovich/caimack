// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { activeLineAt, toLrc } from "./lyrics";
import type { Lyrics } from "./types";

const lyrics = (over: Partial<Lyrics>): Lyrics => ({
  trackId: "t",
  plain: "",
  lines: [],
  source: "Provider",
  ...over,
});

describe("toLrc", () => {
  it("falls back to the plain text when there are no timestamps", () => {
    expect(toLrc(lyrics({ plain: "First line\nSecond line" }))).toBe("First line\nSecond line");
  });

  it("writes hundredths, the precision LRC is normally kept in", () => {
    const built = toLrc(
      lyrics({
        lines: [
          { at: 8460, text: "Do you ever feel like a plastic bag" },
          { at: 12500, text: "Drifting through the wind" },
        ],
      }),
    );

    expect(built).toBe(
      "[00:08.46]Do you ever feel like a plastic bag\n[00:12.50]Drifting through the wind",
    );
  });

  it("keeps three digits when the stamp is finer than a hundredth", () => {
    expect(toLrc(lyrics({ lines: [{ at: 1234, text: "line" }] }))).toBe("[00:01.234]line");
  });

  it("carries minutes past the first hour without losing them", () => {
    expect(toLrc(lyrics({ lines: [{ at: 3_723_000, text: "line" }] }))).toBe("[62:03.00]line");
  });

  it("keeps empty lines, which is how instrumental breaks are marked", () => {
    expect(
      toLrc(
        lyrics({
          lines: [
            { at: 0, text: "" },
            { at: 1000, text: "a" },
          ],
        }),
      ),
    ).toBe("[00:00.00]\n[00:01.00]a");
  });
});

describe("activeLineAt", () => {
  const lines = [
    { at: 1_000, text: "first" },
    { at: 3_000, text: "second" },
    { at: 10_000, text: "third" },
  ];

  it("returns no line before the first timestamp", () => {
    expect(activeLineAt(lines, 999)).toBe(-1);
  });

  it("changes exactly on a line timestamp", () => {
    expect(activeLineAt(lines, 1_000)).toBe(0);
    expect(activeLineAt(lines, 9_999)).toBe(1);
    expect(activeLineAt(lines, 10_000)).toBe(2);
  });

  it("handles an empty document", () => {
    expect(activeLineAt([], 10_000)).toBe(-1);
  });
});

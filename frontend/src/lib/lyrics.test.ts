// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { activeLineAt, toLrc, wordProgress, WordPainter } from "./lyrics";
import type { Lyrics } from "./types";

const lyrics = (over: Partial<Lyrics>): Lyrics => ({
  trackId: "t",
  plain: "",
  lines: [],
  source: "Provider",
  ...over,
});

describe("toLrc", () => {
  it("preserves word intervals including pauses when opening the editor", () => {
    expect(
      toLrc(
        lyrics({
          lines: [
            {
              at: 1000,
              text: "Hello world",
              words: [
                { at: 1000, end: 1500, text: "Hello " },
                { at: 1700, end: 2500, text: "world" },
              ],
            },
          ],
        }),
      ),
    ).toBe("[00:01.00]<00:01.00>Hello <00:01.50><00:01.70>world<00:02.50>");
  });
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

describe("word timing", () => {
  it("fills against the actual interval and handles zero length fragments", () => {
    const word = { at: 1000, end: 2000, text: "word" };
    expect([900, 1000, 1500, 2000].map((at) => wordProgress(word, at))).toEqual([0, 0, 0.5, 1]);
    expect(wordProgress({ ...word, end: 1000 }, 1000)).toBe(1);
    expect(wordProgress(word, Number.NaN)).toBe(0);
  });

  it("resets crossed rows on backward seeks and paints overlapping vocals", () => {
    const word = (at: number, end: number) => ({ at, end, text: "word" });
    const lines = [
      { at: 1000, end: 2500, text: "a", words: [word(1000, 2500)] },
      { at: 1500, end: 2000, text: "b", words: [word(1500, 2000)] },
      { at: 3000, end: 4000, text: "c", words: [word(3000, 4000)] },
    ];
    const elements = lines.map(() => {
      const props = new Map<string, string>();
      return {
        style: {
          getPropertyValue: (k: string) => props.get(k),
          setProperty: (k: string, v: string) => props.set(k, v),
        },
      } as unknown as HTMLElement;
    });
    const painter = new WordPainter(
      lines,
      elements.map((el) => [el]),
    );
    painter.paint(1750, true);
    expect(elements[0].style.getPropertyValue("--lyric-word-fill")).toBe("50.00%");
    expect(elements[1].style.getPropertyValue("--lyric-word-fill")).toBe("50.00%");
    painter.paint(3500);
    painter.paint(1200);
    expect(elements[1].style.getPropertyValue("--lyric-word-fill")).toBe("0.00%");
    expect(elements[2].style.getPropertyValue("--lyric-word-fill")).toBe("0.00%");
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

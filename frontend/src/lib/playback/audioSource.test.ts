// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { bufferedAhead } from "./audioSource";

function audio(currentTime: number, ranges: [number, number][]) {
  return {
    currentTime,
    buffered: {
      length: ranges.length,
      start: (i: number) => ranges[i][0],
      end: (i: number) => ranges[i][1],
    },
  };
}

describe("buffer available to the listener", () => {
  it("does not mistake data beyond a seek gap for playable audio", () => {
    expect(
      bufferedAhead(
        audio(15, [
          [0, 10],
          [20, 50],
        ]),
      ),
    ).toBe(0);
  });
  it("counts only the contiguous data after the current position", () => {
    expect(
      bufferedAhead(
        audio(5, [
          [0, 10],
          [20, 50],
        ]),
      ),
    ).toBe(5);
    expect(
      bufferedAhead(
        audio(25, [
          [0, 10],
          [20, 50],
        ]),
      ),
    ).toBe(25);
  });
  it("handles an empty buffer and the very end of a buffered range", () => {
    expect(bufferedAhead(audio(0, []))).toBe(0);
    expect(bufferedAhead(audio(10, [[0, 10]]))).toBe(0);
  });
});

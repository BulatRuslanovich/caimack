// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { librarySortingStrategy } from "./librarySorting";

describe("library folder hover", () => {
  const keys = ["favorites", "folder:a", "album:b", "album:c"];
  const rects = keys.map((_, index) => ({
    left: 0,
    right: 600,
    top: index * 80,
    bottom: (index + 1) * 80,
    width: 600,
    height: 80,
  }));
  const strategy = librarySortingStrategy(keys);

  it("keeps every entry stationary when a dragged album is over a folder", () => {
    for (let index = 0; index < keys.length; index++) {
      expect(
        strategy({ rects, index, activeIndex: 3, overIndex: 1, activeNodeRect: rects[3] }),
      ).toBeNull();
    }
  });

  it("still animates ordinary sorting over another album", () => {
    expect(
      strategy({ rects, index: 2, activeIndex: 3, overIndex: 2, activeNodeRect: rects[3] }),
    ).toMatchObject({ x: 0, y: 80 });
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { leadArtists } from "@/components/home/DailyMix";
import { tileLayout } from "@/components/home/QuickTiles";

describe("tileLayout", () => {
  it("keeps up to four tiles in a single row", () => {
    expect(tileLayout(3)).toEqual({ perRow: 3, visible: 3 });
    expect(tileLayout(4)).toEqual({ perRow: 4, visible: 4 });
  });

  it("never leaves a ragged last row", () => {
    expect(tileLayout(5)).toEqual({ perRow: 4, visible: 4 });
    expect(tileLayout(6)).toEqual({ perRow: 3, visible: 6 });
    expect(tileLayout(7)).toEqual({ perRow: 3, visible: 6 });
    expect(tileLayout(9)).toEqual({ perRow: 4, visible: 8 });
  });
});

describe("leadArtists", () => {
  const track = (artistName: string) => ({ artistName });

  it("lists distinct artists in play order", () => {
    expect(leadArtists([track("A"), track("B"), track("A")])).toEqual({
      names: ["A", "B"],
      more: false,
    });
  });

  it("says there are more when the mix goes past three artists", () => {
    expect(leadArtists(["A", "B", "C", "D"].map(track))).toEqual({
      names: ["A", "B", "C"],
      more: true,
    });
  });
});

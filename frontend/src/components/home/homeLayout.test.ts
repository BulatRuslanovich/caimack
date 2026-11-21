// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { leadArtists } from "@/components/home/DailyMix";

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

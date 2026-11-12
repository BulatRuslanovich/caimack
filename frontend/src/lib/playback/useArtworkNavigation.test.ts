// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import type { Track } from "@/lib/types";
import { queueArtworkDirection } from "./useArtworkNavigation";

const queue = ["a", "b", "c"].map((id) => ({ id }) as Track);

describe("artwork navigation", () => {
  it("follows queue navigation in both directions", () => {
    const state = { queue, queueOrder: [0, 1, 2], currentIndex: 1, repeat: "off" as const };
    expect(queueArtworkDirection("a", state)).toBe("next");
    expect(queueArtworkDirection("c", state)).toBe("previous");
  });

  it("uses the shuffled playback order instead of the track's library index", () => {
    const state = { queue, queueOrder: [2, 0, 1], currentIndex: 0, repeat: "off" as const };
    expect(queueArtworkDirection("c", state)).toBe("next");
    expect(queueArtworkDirection("b", state)).toBe("previous");
  });

  it("keeps an automatic repeat from the last track to the first moving forward", () => {
    expect(
      queueArtworkDirection("c", {
        queue,
        queueOrder: [0, 1, 2],
        currentIndex: 0,
        repeat: "all",
      }),
    ).toBe("next");
  });

  it("starts a new queue moving forward when the previous track is absent", () => {
    expect(
      queueArtworkDirection("unrelated", {
        queue,
        queueOrder: [0, 1, 2],
        currentIndex: 0,
        repeat: "off",
      }),
    ).toBe("next");
  });
});

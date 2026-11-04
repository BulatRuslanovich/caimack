// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import {
  advanceIn,
  appendTrack,
  appendTracks,
  buildOrder,
  indexAfterRemoval,
  insertAfter,
  moveInQueue,
  radioStartAfterInsert,
  remapIndexAfterMove,
} from "@/lib/playback/playerQueue";
import type { Track } from "@/lib/types";

function track(id: string): Track {
  return {
    id,
    title: id,
    artistId: "artist",
    artistName: "artist",
    durationSeconds: 100,
    originalFileName: `${id}.mp3`,
    isFavorite: false,
    hasCover: false,
    hasLyrics: false,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function tracks(...ids: string[]): Track[] {
  return ids.map(track);
}

function isPermutation(order: number[], length: number): boolean {
  return (
    order.length === length &&
    [...order].sort((a, b) => a - b).every((value, index) => value === index)
  );
}

function playbackFrom(queue: Track[], order: number[], currentIndex: number): string[] {
  return order.slice(order.indexOf(currentIndex)).map((index) => queue[index].id);
}

const ORDERS: number[][] = [
  [0, 1, 2, 3],
  [3, 1, 0, 2],
  [2, 3, 1, 0],
  [1, 0, 3, 2],
];

describe("buildOrder", () => {
  it("keeps natural order when not shuffled", () => {
    expect(buildOrder(4, false, 2)).toEqual([0, 1, 2, 3]);
  });

  it("produces a permutation when shuffled", () => {
    const order = buildOrder(25, true, -1, mulberry(7));
    expect(isPermutation(order, 25)).toBe(true);
  });

  it("puts the starting track first when shuffled", () => {
    for (let seed = 0; seed < 20; seed += 1) {
      expect(buildOrder(12, true, 5, mulberry(seed))[0]).toBe(5);
    }
  });

  it("is deterministic for a given random source", () => {
    expect(buildOrder(10, true, 3, mulberry(1))).toEqual(buildOrder(10, true, 3, mulberry(1)));
  });

  it("handles an empty queue", () => {
    expect(buildOrder(0, true, -1)).toEqual([]);
  });
});

describe("appendTrack", () => {
  it("adds the track last and keeps the order a permutation", () => {
    for (const order of ORDERS) {
      const next = appendTrack(tracks("a", "b", "c", "d"), order, track("x"));

      expect(next.queue.at(-1)?.id).toBe("x");
      expect(next.order.at(-1)).toBe(4);
      expect(isPermutation(next.order, next.queue.length)).toBe(true);
    }
  });
});

describe("appendTracks", () => {
  it("appends a batch and extends the order", () => {
    const next = appendTracks(tracks("a", "b"), [1, 0], tracks("x", "y"));

    expect(next.queue.map((item) => item.id)).toEqual(["a", "b", "x", "y"]);
    expect(next.order).toEqual([1, 0, 2, 3]);
    expect(isPermutation(next.order, next.queue.length)).toBe(true);
  });
});

describe("insertAfter", () => {
  it("plays the inserted track next without moving the current one", () => {
    for (const order of ORDERS) {
      for (let currentIndex = 0; currentIndex < 4; currentIndex += 1) {
        const queue = tracks("a", "b", "c", "d");
        const current = queue[currentIndex].id;
        const next = insertAfter(queue, order, currentIndex, track("x"));

        expect(next.queue[currentIndex].id).toBe(current);
        expect(isPermutation(next.order, next.queue.length)).toBe(true);
        expect(playbackFrom(next.queue, next.order, currentIndex).slice(0, 2)).toEqual([
          current,
          "x",
        ]);
      }
    }
  });

  it("keeps the rest of the order intact", () => {
    const next = insertAfter(tracks("a", "b", "c"), [0, 1, 2], 0, track("x"));

    expect(next.queue.map((item) => item.id)).toEqual(["a", "x", "b", "c"]);
    expect(playbackFrom(next.queue, next.order, 0)).toEqual(["a", "x", "b", "c"]);
  });

  it("works at the tail of the queue", () => {
    const next = insertAfter(tracks("a", "b"), [0, 1], 1, track("x"));

    expect(next.queue.map((item) => item.id)).toEqual(["a", "b", "x"]);
    expect(playbackFrom(next.queue, next.order, 1)).toEqual(["b", "x"]);
  });
});

describe("radioStartAfterInsert", () => {
  it("leaves the untouched sentinel alone", () => {
    expect(radioStartAfterInsert(Number.MAX_SAFE_INTEGER, 1, 4)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("shifts the boundary when inserting at or before it", () => {
    expect(radioStartAfterInsert(2, 1, 4)).toBe(3);
    expect(radioStartAfterInsert(2, 2, 4)).toBe(3);
  });

  it("leaves the boundary alone when inserting after it", () => {
    expect(radioStartAfterInsert(2, 3, 4)).toBe(2);
  });
});

describe("indexAfterRemoval", () => {
  it("empties the queue", () => {
    expect(indexAfterRemoval(0, 0, 0)).toBe(-1);
  });

  it("shifts the active index when an earlier track goes", () => {
    expect(indexAfterRemoval(0, 2, 3)).toBe(1);
  });

  it("keeps the active index when a later track goes", () => {
    expect(indexAfterRemoval(3, 1, 3)).toBe(1);
  });

  it("clamps to the last track when the active one goes", () => {
    expect(indexAfterRemoval(2, 2, 2)).toBe(1);
    expect(indexAfterRemoval(0, 0, 3)).toBe(0);
  });
});

describe("moveInQueue", () => {
  it("moves a track down the list", () => {
    const next = moveInQueue(tracks("a", "b", "c", "d"), [0, 1, 2, 3], 0, 2, false);

    expect(next.queue.map((item) => item.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a track up the list", () => {
    const next = moveInQueue(tracks("a", "b", "c", "d"), [0, 1, 2, 3], 3, 1, false);

    expect(next.queue.map((item) => item.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("makes the new list the playback order when not shuffled", () => {
    const next = moveInQueue(tracks("a", "b", "c", "d"), [0, 1, 2, 3], 3, 0, false);

    expect(next.order).toEqual([0, 1, 2, 3]);
    expect(playbackFrom(next.queue, next.order, 0)).toEqual(["d", "a", "b", "c"]);
  });

  it("keeps the shuffled playback order intact", () => {
    for (const order of ORDERS) {
      for (let from = 0; from < 4; from += 1) {
        for (let to = 0; to < 4; to += 1) {
          const queue = tracks("a", "b", "c", "d");
          const before = order.map((index) => queue[index].id);
          const next = moveInQueue(queue, order, from, to, true);

          expect(isPermutation(next.order, next.queue.length)).toBe(true);
          expect(next.order.map((index) => next.queue[index].id)).toEqual(before);
        }
      }
    }
  });

  it("follows the dragged track with the current index", () => {
    const queue = tracks("a", "b", "c", "d");

    for (let current = 0; current < 4; current += 1) {
      for (let from = 0; from < 4; from += 1) {
        for (let to = 0; to < 4; to += 1) {
          const next = moveInQueue(queue, [0, 1, 2, 3], from, to, false);
          const movedCurrent = remapIndexAfterMove(from, to, current);

          expect(next.queue[movedCurrent].id).toBe(queue[current].id);
        }
      }
    }
  });

  it("leaves the queue alone for a no-op or an out-of-range move", () => {
    const queue = tracks("a", "b");
    const order = [1, 0];

    expect(moveInQueue(queue, order, 1, 1, true)).toEqual({ queue, order });
    expect(moveInQueue(queue, order, -1, 0, true)).toEqual({ queue, order });
    expect(moveInQueue(queue, order, 0, 5, true)).toEqual({ queue, order });
  });
});

describe("advanceIn", () => {
  it("does nothing without a queue or a current track", () => {
    expect(advanceIn([], 0, 1, false)).toEqual({ kind: "none" });
    expect(advanceIn([0, 1], -1, 1, false)).toEqual({ kind: "none" });
    expect(advanceIn([0, 1], 7, 1, false)).toEqual({ kind: "none" });
  });

  it("follows the shuffled order rather than the queue order", () => {
    expect(advanceIn([2, 0, 1], 2, 1, false)).toEqual({ kind: "play", index: 0 });
    expect(advanceIn([2, 0, 1], 0, -1, false)).toEqual({ kind: "play", index: 2 });
  });

  it("restarts the track when stepping back from the first position", () => {
    expect(advanceIn([2, 0, 1], 2, -1, false)).toEqual({ kind: "restart" });
  });

  it("stops at the end without repeat", () => {
    expect(advanceIn([0, 1], 1, 1, false)).toEqual({ kind: "stop" });
  });

  it("wraps to the first track of the order with repeat all", () => {
    expect(advanceIn([2, 0, 1], 1, 1, true)).toEqual({ kind: "play", index: 2 });
  });
});

function mulberry(seed: number): () => number {
  let state = seed + 0x6d2b79f5;

  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

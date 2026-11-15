import type { Track } from "@/lib/types";
import { describe, expect, it } from "vitest";
import { queueEntries, queueEntryKey, sameQueueEntryOrder } from "./queueEntries";

const track = (id: string) => ({ id, title: id }) as Track;
const keys = (tracks: Track[]) => tracks.map(queueEntryKey);

describe("queue occurrence identity", () => {
  it("recognizes stale order snapshots without confusing identical track occurrences", () => {
    const original = queueEntries([track("a"), track("b"), track("a")]);
    expect(
      sameQueueEntryOrder(
        original,
        original.map((item) => ({ ...item, title: "updated" })),
      ),
    ).toBe(true);
    expect(sameQueueEntryOrder(original, [original[2], original[1], original[0]])).toBe(false);
    expect(sameQueueEntryOrder(original, original.slice(1))).toBe(false);
  });
  it("preserves duplicate entries across moves, insertion, edits, and removal", () => {
    const original = queueEntries([track("a"), track("a"), track("b")]);
    expect(new Set(keys(original)).size).toBe(3);
    const moved = queueEntries([original[1], original[2], original[0]], original);
    expect(keys(moved)).toEqual([keys(original)[1], keys(original)[2], keys(original)[0]]);
    const inserted = queueEntries([track("a"), ...moved], moved);
    expect(keys(inserted).slice(1)).toEqual(keys(moved));
    expect(keys(inserted)[0]).not.toBe(keys(original)[0]);
    const edited = queueEntries(
      inserted.map((item) => ({ ...item, title: "edited" })),
      inserted,
    );
    expect(keys(edited)).toEqual(keys(inserted));
    expect(keys(queueEntries(edited.slice(1), edited))).toEqual(keys(moved));
    expect(JSON.parse(JSON.stringify(original))).toEqual([track("a"), track("a"), track("b")]);
  });

  it("reconciles fresh server metadata and returns unchanged stamped arrays", () => {
    const original = queueEntries([track("a"), track("b"), track("a")]);
    expect(queueEntries(original, original)).toBe(original);
    expect(keys(queueEntries([track("b"), track("a"), track("a")], original))).toEqual([
      keys(original)[1],
      keys(original)[0],
      keys(original)[2],
    ]);
  });
});

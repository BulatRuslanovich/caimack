// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import {
  mergeRadioBatch,
  validRadioSession,
  radioRefreshPlan,
  radioReaction,
  radioExclusions,
} from "./radioSession";
import type { RecommendedTrack, Track } from "@/lib/types";

const track = (id: string): Track => ({
  id,
  title: id,
  artistId: "artist",
  artistName: "Artist",
  durationSeconds: 180,
  originalFileName: `${id}.mp3`,
  isFavorite: false,
  hasCover: false,
  hasLyrics: false,
  createdAt: "2026-01-01T00:00:00Z",
});

const recommended = (id: string): RecommendedTrack => ({
  track: track(id),
  reason: { kind: "discovery" },
});

describe("radio session state", () => {
  it("drops tracks already present while retaining reasons", () => {
    const merged = mergeRadioBatch([track("known")], { known: { kind: "soundsLike" } }, {}, [
      recommended("known"),
      recommended("fresh"),
    ]);

    expect(merged.tracks.map((item) => item.id)).toEqual(["fresh"]);
    expect(merged.reasons).toEqual({
      known: { kind: "soundsLike" },
      fresh: { kind: "discovery" },
    });
  });

  it("carries queue signals only for the tracks that have them", () => {
    const explored: RecommendedTrack = {
      ...recommended("fresh"),
      signals: { explore: true },
    };

    const merged = mergeRadioBatch([], {}, {}, [recommended("plain"), explored]);

    expect(Object.keys(merged.signals)).toEqual(["fresh"]);
    expect(merged.signals.fresh.explore).toBe(true);
  });

  it("accepts persisted radio state and rejects malformed values", () => {
    expect(validRadioSession({ seedTrackId: "seed", reasons: {} })).toBe(true);
    expect(validRadioSession(undefined)).toBe(false);
    expect(validRadioSession({ seedTrackId: "seed" })).toBe(false);
    expect(validRadioSession({ reasons: {}, manualTrackIds: ["manual"] })).toBe(true);
    expect(validRadioSession({ reasons: {}, manualTrackIds: "broken" })).toBe(false);
  });
});

describe("adaptive continuation", () => {
  it("allows an older song to return while excluding recent and upcoming entries", () => {
    const queue = ["old", "recent1", "recent2", "current", "next", "manual"].map(track);
    const excluded = radioExclusions(queue, [0, 1, 2, 3, 4, 5], 3);
    expect(excluded).toEqual(["recent1", "recent2", "current", "next", "manual"]);
    const merged = mergeRadioBatch(
      queue,
      {},
      {},
      [recommended("old"), recommended("old"), recommended("next")],
      new Set(excluded),
    );
    expect(merged.tracks.map((item) => item.id)).toEqual(["old"]);
  });

  it("replaces only the automatic future and protects the preloaded next song", () => {
    const queue = ["played", "current", "next", "automatic", "manual"].map(track);
    const plan = radioRefreshPlan(queue, [0, 1, 2, 3, 4], 1, (item) => item.id !== "manual");
    expect(plan.queue.map((item) => item.id)).toEqual(["played", "current", "next", "manual"]);
    expect(plan.order).toEqual([0, 1, 2, 3]);
    expect(plan.queue[plan.index]).toBe(queue[1]);
  });

  it("preserves shuffle history and remaps the current index without restarting it", () => {
    const queue = ["automatic", "current", "manual", "next", "played"].map(track);
    const plan = radioRefreshPlan(queue, [4, 1, 3, 0, 2], 1, (item) => item.id !== "manual");
    expect(plan.queue.map((item) => item.id)).toEqual(["current", "manual", "next", "played"]);
    expect(plan.order).toEqual([3, 0, 2, 1]);
    expect(plan.queue[plan.index]).toBe(queue[1]);
  });

  it("preserves explicit duplicate entries and leaves an unknown traversal alone", () => {
    const queue = ["current", "next", "manual", "manual"].map(track);
    expect(radioRefreshPlan(queue, [0, 1, 2, 3], 0, (item) => item.id !== "manual").queue).toEqual(
      queue,
    );
    expect(radioRefreshPlan(queue, [1, 2, 3], 0, () => true).queue).toBe(queue);
  });

  it("reacts to listening outcomes and strong choices, with a meaningful progress threshold", () => {
    expect(radioReaction({ type: "trackSkipped" })).toBe(true);
    expect(radioReaction({ type: "trackCompleted" })).toBe(true);
    expect(radioReaction({ type: "trackLiked" })).toBe(true);
    expect(radioReaction({ type: "trackReplayed" })).toBe(true);
    expect(radioReaction({ type: "trackAddedToQueue" })).toBe(true);
    expect(radioReaction({ type: "trackStarted" })).toBe(false);
    expect(radioReaction({ type: "trackPlayed", listenedSeconds: 30 })).toBe(false);
    expect(radioReaction({ type: "trackPlayed", listenedSeconds: 60 })).toBe(true);
  });
});

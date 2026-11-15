// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  CAT_CLIPS,
  CAT_SLIDESHOW,
  CatSlideClock,
  catPlaybackPosition,
  catPlaybackRate,
  createCatSlides,
  finishCatSlide,
  requestCatSlide,
  syncCatTrack,
} from "./catSlideshow";

function changesUntil(
  clock: CatSlideClock,
  end: number,
  bpm?: number,
  audioStart = 0,
  beat?: boolean,
) {
  const changes: number[] = [];
  for (let position = 0.25; position <= end; position += 0.25)
    if (clock.advance(position, bpm, audioStart, beat)) changes.push(position);
  return changes;
}

describe("cat slideshow timing", () => {
  it("changes at musical phrase boundaries relative to the audio start", () => {
    expect(changesUntil(new CatSlideClock(0), 19, 120, 2)).toEqual([10, 18]);
    expect(changesUntil(new CatSlideClock(0), 17, 60)).toEqual([8, 16]);
  });
  it("uses a bounded fallback when tempo or a bass onset is unavailable", () => {
    expect(changesUntil(new CatSlideClock(0), 20)).toEqual([8, 16]);
    expect(changesUntil(new CatSlideClock(0), 20, undefined, 0, false)).toEqual([10, 20]);
    expect(changesUntil(new CatSlideClock(0), 8, 0, 0, true)).toEqual([8]);
  });
  it("resets on seeking or resuming without replaying missed changes", () => {
    const clock = new CatSlideClock(0);
    expect(changesUntil(clock, 7, 120)).toEqual([]);
    expect(clock.advance(60, 120)).toBe(false);
    expect(clock.advance(60.25, 120)).toBe(false);
    expect(clock.advance(3, 120)).toBe(false);
    clock.reset(12);
    expect(clock.advance(12.25, 120)).toBe(false);
    expect(clock.advance(Number.NaN, 120)).toBe(false);
  });
  it("fits a video loop to whole beats without extreme speed changes", () => {
    expect(catPlaybackRate(3, 120)).toBe(1);
    const rate = catPlaybackRate(1.6, 120);
    expect(1.6 / rate).toBeCloseTo(1.5);
    expect(catPlaybackRate(0.1, 40)).toBe(CAT_SLIDESHOW.minimumRate);
    expect(catPlaybackRate(0, 120)).toBe(1);
    expect(catPlaybackRate(Infinity, 120)).toBe(1);
    expect(catPlaybackRate(3, undefined)).toBe(1);
    expect(catPlaybackPosition(15, 2, 3, 1)).toBe(1);
    expect(catPlaybackPosition(1, 2, 3, 1)).toBe(0);
    expect(catPlaybackPosition(15, 0, 0, 1)).toBe(0);
  });
});

describe("cat slideshow transitions", () => {
  it("opens without a fake track change and includes four distinct clips", () => {
    const initial = createCatSlides("track-a");
    expect(syncCatTrack(initial, "track-a")).toBe(initial);
    expect(initial.previous).toBeNull();
    expect(new Set(CAT_CLIPS.map((clip) => clip.video)).size).toBe(4);
  });
  it("keeps two layers and applies only the latest rapid selection", () => {
    let state = requestCatSlide(createCatSlides("a"), 1);
    const firstRevision = state.revision;
    state = requestCatSlide(state, 2);
    state = requestCatSlide(state, 3);
    expect([state.previous, state.current, state.pending]).toEqual([0, 1, 3]);
    state = finishCatSlide(state, firstRevision);
    expect([state.previous, state.current, state.pending]).toEqual([1, 3, null]);
    expect(finishCatSlide(state, firstRevision)).toBe(state);
    state = finishCatSlide(state, state.revision);
    expect([state.previous, state.current]).toEqual([null, 3]);
  });
  it("wraps around and does not restart a transition for the same track", () => {
    const initial = requestCatSlide(createCatSlides("a"), CAT_CLIPS.length - 1);
    const settled = finishCatSlide(initial, initial.revision);
    const next = syncCatTrack(settled, "b");
    expect(next.current).toBe(0);
    expect(syncCatTrack(next, "b")).toBe(next);
    expect(requestCatSlide(next, 0).pending).toBeNull();
  });
  it("keeps the chosen cat when a track changes in manual mode", () => {
    const initial = requestCatSlide(createCatSlides("a"), 2);
    const settled = finishCatSlide(initial, initial.revision);
    const next = syncCatTrack(settled, "b", false);
    expect(next.trackId).toBe("b");
    expect(next.current).toBe(2);
    expect(next.previous).toBeNull();
  });
});

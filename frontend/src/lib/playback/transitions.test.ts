// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import {
  SPLICE_LEAD_SECONDS,
  TRANSITION_PRELOAD_LEAD_SECONDS,
  continuesAlbum,
  planTransition,
  temposMatch,
  transitionStage,
  type TransitionTrack,
} from "@/lib/playback/transitions";

function track(id: string, extra: Partial<TransitionTrack> = {}): TransitionTrack {
  return { id, durationSeconds: 240, ...extra };
}

function plan(overrides: Partial<Parameters<typeof planTransition>[0]> = {}) {
  return planTransition({
    crossfade: 0,
    smart: true,
    canFade: true,
    repeat: "off",
    current: track("a"),
    currentDuration: 240,
    next: track("b"),
    ...overrides,
  });
}

const cues = (audioStart: number, audioEnd: number, outroStart = audioEnd, bpm?: number) => ({
  audioStart,
  audioEnd,
  outroStart,
  bpm,
});

describe("planTransition", () => {
  it("has nothing to plan when nothing different follows", () => {
    expect(plan({ next: null })).toBeNull();
    expect(plan({ next: track("a") })).toBeNull();
    expect(plan({ repeat: "one" })).toBeNull();
  });

  it("splices without crossfade off at the very end of the file", () => {
    expect(plan()).toEqual({
      kind: "cut",
      at: 240 - SPLICE_LEAD_SECONDS,
      fade: 0,
      nextStartAt: 0,
    });
  });

  it("joins an album played in order gaplessly even with crossfade on", () => {
    const current = track("a", { albumId: "x", trackNumber: 3, cues: cues(2, 230) });
    const next = track("b", { albumId: "x", trackNumber: 4, cues: cues(1.5, 238) });

    expect(plan({ crossfade: 8, current, next })).toEqual({
      kind: "gapless",
      at: 240 - SPLICE_LEAD_SECONDS,
      fade: 0,
      nextStartAt: 0,
    });
  });

  it("trims the silence between unrelated tracks", () => {
    const result = plan({
      current: track("a", { cues: cues(0, 236.5) }),
      next: track("b", { cues: cues(1.8, 239) }),
    });

    expect(result?.kind).toBe("cut");
    expect(result?.at).toBeCloseTo(236.5 - SPLICE_LEAD_SECONDS);
    expect(result?.nextStartAt).toBe(1.8);
  });

  it("leaves the files alone with smart transitions off", () => {
    const result = plan({
      smart: false,
      crossfade: 5,
      current: track("a", { cues: cues(0, 230, 220, 120) }),
      next: track("b", { cues: cues(2, 239) }),
    });

    expect(result).toEqual({ kind: "crossfade", at: 235, fade: 5, nextStartAt: 0 });
  });

  it("stretches the crossfade into a long fade-out, at most twice", () => {
    const short = plan({ crossfade: 5, current: track("a", { cues: cues(0, 236, 229) }) });
    expect(short?.fade).toBeCloseTo(7);
    expect(short?.at).toBeCloseTo(229);

    const long = plan({ crossfade: 5, current: track("a", { cues: cues(0, 236, 210) }) });
    expect(long?.fade).toBeCloseTo(10);
  });

  it("lands a crossfade on whole bars when the tempos agree", () => {
    const result = plan({
      crossfade: 5,
      current: track("a", { cues: cues(0, 240, 240, 100) }),
      next: track("b", { cues: cues(0, 240, 240, 101) }),
    });

    expect(result?.fade).toBeCloseTo(4.8);
  });

  it("hears double time as the same pulse", () => {
    expect(temposMatch(87, 174)).toBe(true);
    expect(temposMatch(128, 64.5)).toBe(true);
    expect(temposMatch(120, 140)).toBe(false);
  });

  it("keeps a crossfade between clashing tempos short", () => {
    const result = plan({
      crossfade: 8,
      current: track("a", { cues: cues(0, 240, 240, 120) }),
      next: track("b", { cues: cues(0, 240, 240, 95) }),
    });

    expect(result?.fade).toBe(2);
  });

  it("never covers more than half of either track", () => {
    expect(plan({ crossfade: 8, currentDuration: 10 })?.fade).toBe(5);
    expect(plan({ crossfade: 8, next: track("b", { durationSeconds: 6 }) })?.fade).toBe(3);
  });

  it("only splices when the volume cannot be scripted", () => {
    const result = plan({ crossfade: 8, canFade: false });

    expect(result).toEqual({ kind: "cut", at: 240 - SPLICE_LEAD_SECONDS, fade: 0, nextStartAt: 0 });
  });

  it("does not skip into the second half of a track that is mostly silence", () => {
    const result = plan({ next: track("b", { durationSeconds: 20, cues: cues(15, 20) }) });

    expect(result?.nextStartAt).toBe(0);
  });
});

describe("continuesAlbum", () => {
  it("needs the same album and disc and the very next number", () => {
    const at = (trackNumber: number, discNumber = 1, albumId = "x") =>
      track(`t${trackNumber}`, { albumId, trackNumber, discNumber });

    expect(continuesAlbum(at(1), at(2))).toBe(true);
    expect(continuesAlbum(at(1), at(3))).toBe(false);
    expect(continuesAlbum(at(1), at(2, 2))).toBe(false);
    expect(continuesAlbum(at(1), at(2, 1, "y"))).toBe(false);
    expect(continuesAlbum(track("a"), track("b"))).toBe(false);
  });
});

describe("transitionStage", () => {
  const planned = { kind: "crossfade" as const, at: 200, fade: 5, nextStartAt: 0 };

  it("preloads the lead time before the switch and is due from it on", () => {
    expect(transitionStage(200 - TRANSITION_PRELOAD_LEAD_SECONDS - 0.1, planned)).toBe("wait");
    expect(transitionStage(200 - TRANSITION_PRELOAD_LEAD_SECONDS, planned)).toBe("preload");
    expect(transitionStage(199.9, planned)).toBe("preload");
    expect(transitionStage(200, planned)).toBe("due");
    expect(transitionStage(230, planned)).toBe("due");
  });

  it("waits without a plan", () => {
    expect(transitionStage(239, null)).toBe("wait");
  });
});

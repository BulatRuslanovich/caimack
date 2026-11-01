// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import {
  PlaybackRecovery,
  STREAM_RETRY_DELAYS_MS,
  TRANSCODE_WAIT_DELAYS_MS,
} from "@/lib/playback/playbackRecovery";

const MEDIA_ERR_NETWORK = 2;

const MEDIA_ERR_DECODE = 3;

const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

function failing(recovery: PlaybackRecovery, errorCode: number | undefined, trackId = "t1") {
  return recovery.decide({ trackId, errorCode, offline: false });
}

function fallenBack(errorCode = MEDIA_ERR_DECODE) {
  const recovery = new PlaybackRecovery();
  failing(recovery, errorCode);
  failing(recovery, errorCode);
  return recovery;
}

describe("fail / recover", () => {
  it("does not restart music after a manual pause while offline", () => {
    const recovery = new PlaybackRecovery();
    recovery.fail("t1", true);
    recovery.setIntent(false);
    expect(recovery.recover()).toEqual({ resume: false });
  });
  it("reports only the first failure so the listener is told once", () => {
    const recovery = new PlaybackRecovery();

    expect(recovery.fail("t1", true)).toBe(true);
    expect(recovery.fail("t1", false)).toBe(false);
  });

  it("keeps the intent to listen sticky across repeated failures", () => {
    const recovery = new PlaybackRecovery();

    recovery.fail("t1", true);
    recovery.fail("t1", false);

    expect(recovery.recover()).toEqual({ resume: true });
  });

  it("has nothing to recover when nothing broke", () => {
    expect(new PlaybackRecovery().recover()).toBeNull();
  });

  it("recovers only once per failure", () => {
    const recovery = new PlaybackRecovery();
    recovery.fail("t1", true);

    expect(recovery.recover()).toEqual({ resume: true });
    expect(recovery.recover()).toBeNull();
  });

  it("forgets the failure when the source is rebuilt normally", () => {
    const recovery = new PlaybackRecovery();
    recovery.fail("t1", true);
    recovery.clearFailure();

    expect(recovery.recover()).toBeNull();
  });
});

describe("decide", () => {
  it("retries once before blaming the format — the first failure may be a stale session", () => {
    expect(failing(new PlaybackRecovery(), MEDIA_ERR_DECODE)).toMatchObject({
      kind: "retry",
      attempt: 0,
    });
  });

  it("falls back to the adaptive stream when a renewed session still cannot decode", () => {
    for (const errorCode of [MEDIA_ERR_DECODE, MEDIA_ERR_SRC_NOT_SUPPORTED]) {
      const recovery = new PlaybackRecovery();
      failing(recovery, errorCode);

      expect(failing(recovery, errorCode)).toEqual({ kind: "fallback" });
    }
  });

  it("does not fall back twice and waits for the transcode instead", () => {
    const recovery = fallenBack();

    for (const [attempt, delayMs] of TRANSCODE_WAIT_DELAYS_MS.entries()) {
      expect(failing(recovery, MEDIA_ERR_DECODE)).toEqual({ kind: "retry", attempt, delayMs });
    }
    expect(failing(recovery, MEDIA_ERR_DECODE)).toEqual({ kind: "giveUp" });
  });

  it("backs off network errors on the same source and then gives up", () => {
    const recovery = new PlaybackRecovery();

    for (const [attempt, delayMs] of STREAM_RETRY_DELAYS_MS.entries()) {
      expect(failing(recovery, MEDIA_ERR_NETWORK)).toEqual({ kind: "retry", attempt, delayMs });
    }
    expect(failing(recovery, MEDIA_ERR_NETWORK)).toEqual({ kind: "giveUp" });
  });

  it("retries when the element reports no error code", () => {
    expect(failing(new PlaybackRecovery(), undefined)).toMatchObject({ kind: "retry" });
  });

  it("starts counting from scratch on a different track", () => {
    const recovery = new PlaybackRecovery();
    failing(recovery, MEDIA_ERR_NETWORK, "t1");

    expect(failing(recovery, MEDIA_ERR_NETWORK, "t2")).toMatchObject({ attempt: 0 });
  });

  it("drops the attempt count once sound actually starts", () => {
    const recovery = new PlaybackRecovery();
    failing(recovery, MEDIA_ERR_NETWORK);
    recovery.playing();

    expect(failing(recovery, MEDIA_ERR_NETWORK)).toMatchObject({ attempt: 0 });
  });

  it("waits for the network instead of burning retries while offline", () => {
    for (const errorCode of [MEDIA_ERR_NETWORK, MEDIA_ERR_DECODE, undefined]) {
      expect(new PlaybackRecovery().decide({ trackId: "t1", errorCode, offline: true })).toEqual({
        kind: "offline",
      });
    }
  });
});

describe("adaptive delivery of the original", () => {
  it("tries Original again on later tracks after two minutes, without forgetting format failures", () => {
    const recovery = fallenBack();
    recovery.degrade(1000);
    expect(recovery.forceAdaptive("Original", "t2", 120_999)).toBe(true);
    expect(recovery.forceAdaptive("Original", "t2", 121_000)).toBe(false);
    expect(recovery.forceAdaptive("Original", "t1", 121_000)).toBe(true);
  });
  it("leaves chosen tiers alone — only the original is ever switched", () => {
    const recovery = fallenBack();
    recovery.degrade();

    expect(recovery.forceAdaptive("Low", "t1")).toBe(false);
  });

  it("keeps a track whose original did not decode on adaptive delivery", () => {
    const recovery = fallenBack();

    expect(recovery.forceAdaptive("Original", "t1")).toBe(true);
    expect(recovery.forceAdaptive("Original", "t2")).toBe(false);
  });

  it("moves every original to adaptive delivery once one has stalled", () => {
    const recovery = new PlaybackRecovery();
    recovery.degrade();

    expect(recovery.degraded).toBe(true);
    expect(recovery.forceAdaptive("Original", "t1")).toBe(true);
    expect(recovery.forceAdaptive("Original", "t2")).toBe(true);
  });

  it("gives the original another chance when the listener picks a quality again", () => {
    const recovery = fallenBack();
    recovery.degrade();

    recovery.reset();

    expect(recovery.forceAdaptive("Original", "t1")).toBe(false);
    failing(recovery, MEDIA_ERR_DECODE, "t3");
    expect(failing(recovery, MEDIA_ERR_DECODE, "t3")).toEqual({ kind: "fallback" });
  });
});

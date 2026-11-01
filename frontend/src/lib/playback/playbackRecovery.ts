// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

import type { AudioQuality } from "@/lib/types";

export const STREAM_RETRY_DELAYS_MS = [800, 2500, 6000, 15_000, 30_000];

export const TRANSCODE_WAIT_DELAYS_MS = [1500, 4000, 9000, 18000];

const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

type Recovery =
  | { kind: "fallback" }
  | { kind: "offline" }
  | { kind: "retry"; attempt: number; delayMs: number }
  | { kind: "giveUp" };

export class PlaybackRecovery {
  private retry: { trackId: string; attempts: number } = { trackId: "", attempts: 0 };

  private failed: { trackId: string; resume: boolean } | null = null;

  private readonly fellBack = new Set<string>();

  private stalled = false;
  private degradedUntil = 0;

  reset(): void {
    this.fellBack.clear();
    this.stalled = false;
    this.degradedUntil = 0;
  }

  fail(trackId: string | undefined, resume: boolean): boolean {
    const first = this.failed === null;

    if (trackId) {
      this.failed = { trackId, resume: resume || this.failed?.resume === true };
    }

    return first;
  }

  recover(): { resume: boolean } | null {
    const failed = this.failed;
    if (!failed) return null;

    this.failed = null;
    this.retry = { ...this.retry, attempts: 0 };

    return { resume: failed.resume };
  }

  clearFailure(): void {
    this.failed = null;
  }

  setIntent(resume: boolean): void {
    if (this.failed) this.failed.resume = resume;
  }

  degrade(now = Date.now()): void {
    this.stalled = true;
    this.degradedUntil = now + 120_000;
  }

  get degraded(): boolean {
    return this.stalled;
  }

  forceAdaptive(quality: AudioQuality, trackId: string, now = Date.now()): boolean {
    return (
      quality === "Original" &&
      ((this.stalled && now < this.degradedUntil) || this.fellBack.has(trackId))
    );
  }

  loaded(trackId: string): void {
    this.retry = { trackId, attempts: 0 };
  }

  playing(): void {
    this.retry.attempts = 0;
  }

  decide(input: { trackId: string; errorCode: number | undefined; offline: boolean }): Recovery {
    if (this.retry.trackId !== input.trackId) {
      this.retry = { trackId: input.trackId, attempts: 0 };
    }

    if (input.offline) return { kind: "offline" };

    const fellBack = this.fellBack.has(input.trackId);
    const undecodable =
      input.errorCode === MEDIA_ERR_DECODE || input.errorCode === MEDIA_ERR_SRC_NOT_SUPPORTED;

    if (undecodable && !fellBack && this.retry.attempts > 0) {
      this.fellBack.add(input.trackId);
      this.retry = { trackId: input.trackId, attempts: 0 };
      return { kind: "fallback" };
    }

    const delays = fellBack ? TRANSCODE_WAIT_DELAYS_MS : STREAM_RETRY_DELAYS_MS;
    const attempt = this.retry.attempts;
    if (attempt >= delays.length) return { kind: "giveUp" };

    this.retry.attempts = attempt + 1;
    return { kind: "retry", attempt, delayMs: delays[attempt] };
  }
}

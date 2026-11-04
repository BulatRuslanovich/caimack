// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { RepeatMode } from "@/lib/playback/playerTypes";

export const CROSSFADE_CHOICES = [0, 3, 5, 8] as const;

export const CROSSFADE_PRELOAD_LEAD_SECONDS = 20;

const MIN_CROSSFADE_SECONDS = 1;

const TICK_MS = 50;

interface Timed {
  id: string;
  durationSeconds: number;
}

export function crossfadeSeconds(input: {
  setting: number;
  repeat: RepeatMode;
  current: Timed;
  currentDuration: number;
  next: Timed | null;
}): number {
  const { setting, repeat, current, currentDuration, next } = input;
  if (setting <= 0 || repeat === "one" || !next || next.id === current.id) return 0;

  const seconds = Math.min(setting, currentDuration / 2, next.durationSeconds / 2);
  return seconds >= MIN_CROSSFADE_SECONDS ? seconds : 0;
}

export function crossfadeStage(remaining: number, seconds: number): "wait" | "preload" | "fade" {
  if (seconds <= 0 || remaining <= 0 || remaining > seconds + CROSSFADE_PRELOAD_LEAD_SECONDS) {
    return "wait";
  }

  return remaining > seconds ? "preload" : "fade";
}

export function fadeGains(progress: number): { outgoing: number; incoming: number } {
  const angle = (Math.min(Math.max(progress, 0), 1) * Math.PI) / 2;
  return { outgoing: Math.cos(angle), incoming: Math.sin(angle) };
}

type Channel = Pick<HTMLMediaElement, "volume" | "currentTime" | "ended" | "play" | "pause">;

interface Transition {
  outgoing: Channel;
  incoming: Channel;
  from: number;
  seconds: number;
  release: () => void;
}

export class Crossfade {
  private transition: Transition | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private volume = 1;
  private gains = new WeakMap<Channel, number>();

  get active(): boolean {
    return this.transition !== null;
  }

  get level(): number {
    return this.volume;
  }

  levelFor(channel: Channel): number {
    return this.volume * (this.gains.get(channel) ?? 1);
  }

  setGain(channel: Channel, gain: number): void {
    this.gains.set(channel, gain);
    this.tick();
  }

  start(outgoing: Channel, incoming: Channel, seconds: number, release: () => void): void {
    this.finish();

    this.transition = { outgoing, incoming, from: incoming.currentTime, seconds, release };
    this.tick();
    this.timer ??= setInterval(() => this.tick(), TICK_MS);
  }

  setLevel(volume: number): void {
    this.volume = volume;
    this.tick();
  }

  tick(): void {
    const transition = this.transition;
    if (!transition) return;

    const progress = (transition.incoming.currentTime - transition.from) / transition.seconds;
    if (progress >= 1 || transition.outgoing.ended) {
      this.finish();
      return;
    }

    const gains = fadeGains(progress);
    transition.outgoing.volume = this.levelFor(transition.outgoing) * gains.outgoing;
    transition.incoming.volume = this.levelFor(transition.incoming) * gains.incoming;
  }

  pause(): void {
    this.stopTimer();
    this.transition?.outgoing.pause();
  }

  resume(): void {
    const transition = this.transition;
    if (!transition) return;

    if (!transition.outgoing.ended) void transition.outgoing.play().catch(() => {});
    this.timer ??= setInterval(() => this.tick(), TICK_MS);
  }

  finish(): void {
    const transition = this.transition;
    if (!transition) return;

    this.transition = null;
    this.stopTimer();

    transition.incoming.volume = this.levelFor(transition.incoming);
    transition.outgoing.pause();
    transition.release();
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}

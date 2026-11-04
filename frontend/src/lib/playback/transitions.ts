// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { RepeatMode } from "@/lib/playback/playerTypes";
import type { TrackCues } from "@/lib/types";

export type TransitionKind = "gapless" | "crossfade" | "cut";

export interface TransitionPlan {
  kind: TransitionKind;
  at: number;
  fade: number;
  nextStartAt: number;
}

export interface TransitionTrack {
  id: string;
  durationSeconds: number;
  albumId?: string | null;
  discNumber?: number | null;
  trackNumber?: number | null;
  cues?: TrackCues | null;
}

export const TRANSITION_PRELOAD_LEAD_SECONDS = 45;

export const SPLICE_LEAD_SECONDS = 0.03;

const MIN_CROSSFADE_SECONDS = 1;

const OUTRO_STRETCH = 2;

const TEMPO_TOLERANCE = 0.04;
const CLASHING_TEMPO_FADE_SECONDS = 2;

export function continuesAlbum(current: TransitionTrack, next: TransitionTrack): boolean {
  return (
    !!current.albumId &&
    current.albumId === next.albumId &&
    (current.discNumber ?? 1) === (next.discNumber ?? 1) &&
    current.trackNumber != null &&
    next.trackNumber === current.trackNumber + 1
  );
}

export function temposMatch(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false;

  return [1, 2, 0.5].some((ratio) => Math.abs(a / b / ratio - 1) <= TEMPO_TOLERANCE);
}

export function planTransition(input: {
  crossfade: number;
  smart: boolean;
  canFade: boolean;
  repeat: RepeatMode;
  current: TransitionTrack;
  currentDuration: number;
  next: TransitionTrack | null;
}): TransitionPlan | null {
  const { crossfade, smart, canFade, repeat, current, currentDuration, next } = input;
  if (repeat === "one" || !next || next.id === current.id) return null;

  const duration = currentDuration > 0 ? currentDuration : current.durationSeconds;
  if (duration <= 0) return null;

  if (continuesAlbum(current, next)) {
    return {
      kind: "gapless",
      at: Math.max(0, duration - SPLICE_LEAD_SECONDS),
      fade: 0,
      nextStartAt: 0,
    };
  }

  const currentCues = smart ? current.cues : null;
  const nextCues = smart ? next.cues : null;

  const end = currentCues ? Math.min(currentCues.audioEnd, duration) : duration;
  const nextStartAt =
    nextCues && nextCues.audioStart < next.durationSeconds / 2 ? nextCues.audioStart : 0;
  const nextLength = next.durationSeconds - nextStartAt;

  let fade = canFade ? crossfade : 0;

  if (fade > 0 && currentCues) {
    const outro = end - currentCues.outroStart;
    if (outro > fade) fade = Math.min(outro, fade * OUTRO_STRETCH);
  }

  if (fade > 0 && currentCues?.bpm && nextCues?.bpm) {
    fade = temposMatch(currentCues.bpm, nextCues.bpm)
      ? onBeats(fade, currentCues.bpm)
      : Math.min(fade, CLASHING_TEMPO_FADE_SECONDS);
  }

  fade = Math.min(fade, end / 2, nextLength / 2);

  if (fade >= MIN_CROSSFADE_SECONDS) {
    return { kind: "crossfade", at: end - fade, fade, nextStartAt };
  }

  return { kind: "cut", at: Math.max(0, end - SPLICE_LEAD_SECONDS), fade: 0, nextStartAt };
}

function onBeats(seconds: number, bpm: number): number {
  const beat = 60 / bpm;
  const beats = seconds / beat;
  const whole =
    beats >= 4 ? Math.max(4, Math.round(beats / 4) * 4) : Math.max(1, Math.round(beats));

  return whole * beat;
}

export type TransitionStage = "wait" | "preload" | "due";

export function transitionStage(position: number, plan: TransitionPlan | null): TransitionStage {
  if (!plan) return "wait";

  const until = plan.at - position;
  if (until > TRANSITION_PRELOAD_LEAD_SECONDS) return "wait";

  return until > 0 ? "preload" : "due";
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { Track } from "@/lib/types";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { Crossfade } from "./crossfade";
import type { PendingSwitch, Standby } from "./playbackEngineTypes";
import type { ListeningTracker } from "./playbackTelemetry";
import type { RepeatMode } from "./playerTypes";
import { planTransition, transitionStage } from "./transitions";

interface TransitionInput {
  audioRef: RefObject<HTMLAudioElement | null>;
  currentTrack: Track | null;
  nextTrack: Track | null;
  crossfade: number;
  smartTransitions: boolean;
  repeat: RepeatMode;
  switchPendingRef: RefObject<PendingSwitch | null>;
  crossfader: Crossfade;
  scrubRef: RefObject<number | null>;
  prepareNext: (track: Track, startAt: number) => void;
  switchTimerRef: RefObject<number | null>;
  standbyRef: RefObject<Standby | null>;
  spareAudio: () => HTMLAudioElement | null;
  clearSwitchTimer: () => void;
  tracker: ListeningTracker;
  onTrackEnded: () => void;
}
const SWITCH_TIMER_WINDOW_SECONDS = 0.6;
let scriptableVolume: boolean | null = null;

export function useTransitionScheduler({
  audioRef,
  currentTrack,
  nextTrack,
  crossfade,
  smartTransitions,
  repeat,
  switchPendingRef,
  crossfader,
  scrubRef,
  prepareNext,
  switchTimerRef,
  standbyRef,
  spareAudio,
  clearSwitchTimer,
  tracker,
  onTrackEnded,
}: TransitionInput) {
  const checkTransitionRef = useRef<() => void>(() => {});

  const checkTransition = useCallback(() => {
    const audio = audioRef.current;
    const track = currentTrack;
    if (!audio || !track || !nextTrack || switchPendingRef.current || crossfader.active) return;
    if (scrubRef.current !== null) return;

    scriptableVolume ??=
      Object.assign(document.createElement("audio"), { volume: 0.5 }).volume === 0.5;

    const at = audio.currentTime;
    const plan = planTransition({
      crossfade,
      smart: smartTransitions,
      canFade: scriptableVolume,
      repeat,
      current: track,
      currentDuration: Number.isFinite(audio.duration) ? audio.duration : track.durationSeconds,
      next: nextTrack,
    });

    const stage = transitionStage(at, plan);
    if (!plan || stage === "wait") return;

    prepareNext(nextTrack, plan.nextStartAt);

    if (stage === "preload") {
      const until = (plan.at - at) / (audio.playbackRate || 1);

      if (until < SWITCH_TIMER_WINDOW_SECONDS && switchTimerRef.current === null && !audio.paused) {
        switchTimerRef.current = window.setTimeout(() => {
          switchTimerRef.current = null;
          checkTransitionRef.current();
        }, until * 1000);
      }
      return;
    }

    const incoming = spareAudio();
    if (
      audio.paused ||
      !standbyRef.current?.ready ||
      !incoming ||
      incoming.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
      return;
    }

    clearSwitchTimer();
    switchPendingRef.current = { from: audio, fade: plan.fade };

    if (plan.fade === 0) {
      incoming.volume = crossfader.levelFor(incoming);
      void incoming.play().catch(() => {});
    }

    tracker.finish("trackCompleted");
    onTrackEnded();
  }, [
    audioRef,
    switchPendingRef,
    scrubRef,
    switchTimerRef,
    standbyRef,
    currentTrack,
    nextTrack,
    crossfade,
    smartTransitions,
    repeat,
    tracker,
    crossfader,
    prepareNext,
    spareAudio,
    clearSwitchTimer,
    onTrackEnded,
  ]);

  useEffect(() => {
    checkTransitionRef.current = checkTransition;
  }, [checkTransition]);

  return checkTransitionRef;
}

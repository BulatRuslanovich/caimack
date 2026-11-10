// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useT } from "@/contexts/I18nContext";
import { refreshSession } from "@/lib/http";
import type { AudioQuality, Track } from "@/lib/types";
import { useToast } from "@/lib/useToast";
import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { AdaptivePlayback } from "./adaptivePlayback";
import { bufferedAhead } from "./audioSource";
import type { PlaybackRecovery } from "./playbackRecovery";
import type { ListeningTracker } from "./playbackTelemetry";

interface RecoveryInput {
  audioRef: RefObject<HTMLAudioElement | null>;
  adaptiveRef: RefObject<AdaptivePlayback | null>;
  currentTrack: Track | null;
  isPlaying: boolean;
  quality: AudioQuality;
  positionRef: RefObject<number>;
  pendingSeekRef: RefObject<number | null>;
  recovery: PlaybackRecovery;
  failSource: (resume: boolean) => boolean;
  setWaiting: Dispatch<SetStateAction<boolean>>;
  setSourceRevision: Dispatch<SetStateAction<number>>;
  retryTimerRef: RefObject<number | null>;
  waitingTimerRef: RefObject<number | null>;
  resumeAfterScrub: RefObject<{ muted: boolean; isPlaying: boolean }>;
  tracker: ListeningTracker;
  onTrackEnded: () => void;
}

export function useProgressiveRecovery({
  audioRef,
  adaptiveRef,
  currentTrack,
  isPlaying,
  quality,
  positionRef,
  pendingSeekRef,
  recovery,
  failSource,
  setWaiting,
  setSourceRevision,
  retryTimerRef,
  waitingTimerRef,
  resumeAfterScrub,
  tracker,
  onTrackEnded,
}: RecoveryInput) {
  const t = useT();
  const { notify } = useToast();
  const handleError = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (audio.dataset.playbackMode !== "progressive") return;

    const resumeAt = audio.currentTime > 0 ? audio.currentTime : positionRef.current;

    const decision = recovery.decide({
      trackId: currentTrack.id,
      errorCode: audio.error?.code,
      offline: typeof navigator !== "undefined" && !navigator.onLine,
    });

    if (decision.kind === "offline") {
      if (failSource(isPlaying)) notify(t("player.offlineWaiting"), "info");
      setWaiting(true);
      return;
    }

    if (
      decision.kind === "retry" &&
      decision.attempt > 0 &&
      audio.error?.code === 2 &&
      quality === "Original" &&
      !recovery.degraded
    ) {
      pendingSeekRef.current = resumeAt;
      recovery.degrade();
      notify(t("player.qualityReduced"), "info");
      setSourceRevision((revision) => revision + 1);
      return;
    }

    if (decision.kind === "giveUp") {
      if (audio.error?.code === 2 || audio.error?.code === undefined) {
        if (failSource(isPlaying)) notify(t("player.offlineWaiting"), "info");
        setWaiting(true);
        if (isPlaying)
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            setSourceRevision((revision) => revision + 1);
          }, 30_000);
        return;
      }
      recovery.recover();

      tracker.discard();
      if (isPlaying) {
        notify(t("player.skippedUnplayable", { title: currentTrack.title }), "info");
        onTrackEnded();
      }
      return;
    }

    if (decision.kind === "fallback") {
      notify(t("player.qualityFallback"), "info");
      pendingSeekRef.current = resumeAt;
      setSourceRevision((revision) => revision + 1);
      return;
    }

    const { attempt } = decision;

    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;

      const element = audioRef.current;
      if (!element || element.dataset.trackId !== currentTrack.id) return;

      const retry = () => {
        if (
          element.dataset.playbackMode !== "progressive" ||
          audioRef.current !== element ||
          element.dataset.trackId !== currentTrack.id ||
          !resumeAfterScrub.current.isPlaying
        )
          return;
        void adaptiveRef.current
          ?.load({
            trackId: currentTrack.id,
            quality,
            forceAdaptive: recovery.forceAdaptive(quality, currentTrack.id),
            startAt: resumeAt,
            play: true,
          })
          .catch(() => {
            if (failSource(true)) notify(t("player.offlineWaiting"), "info");
          });
      };

      if (attempt === 0) void refreshSession().then(retry);
      else retry();
    }, decision.delayMs);
  }, [
    currentTrack,
    isPlaying,
    quality,
    notify,
    t,
    recovery,
    failSource,
    onTrackEnded,
    tracker,
    audioRef,
    adaptiveRef,
    positionRef,
    pendingSeekRef,
    setWaiting,
    setSourceRevision,
    retryTimerRef,
    resumeAfterScrub,
  ]);

  const handleWaiting = useCallback(() => {
    const audio = audioRef.current;

    if (
      !audio ||
      !currentTrack ||
      !isPlaying ||
      quality !== "Original" ||
      audio.dataset.playbackMode !== "progressive" ||
      recovery.forceAdaptive(quality, currentTrack.id) ||
      audio.seeking ||
      waitingTimerRef.current !== null
    ) {
      return;
    }

    if (bufferedAhead(audio) > 2) return;

    waitingTimerRef.current = window.setTimeout(() => {
      waitingTimerRef.current = null;
      if (
        audioRef.current !== audio ||
        !resumeAfterScrub.current.isPlaying ||
        (audio.paused && audio.dataset.sourceLoading !== "true") ||
        audio.seeking ||
        audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA ||
        !navigator.onLine
      )
        return;
      pendingSeekRef.current = audio.currentTime;
      recovery.degrade();
      notify(t("player.qualityReduced"), "info");
      setSourceRevision((revision) => revision + 1);
    }, 4000);
  }, [
    currentTrack,
    quality,
    recovery,
    isPlaying,
    notify,
    t,
    audioRef,
    waitingTimerRef,
    pendingSeekRef,
    resumeAfterScrub,
    setSourceRevision,
  ]);

  return { handleError, handleWaiting };
}

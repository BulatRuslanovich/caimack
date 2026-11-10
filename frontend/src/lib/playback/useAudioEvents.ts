// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import {
  useCallback,
  type ComponentPropsWithoutRef,
  type SyntheticEvent,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ListeningTracker } from "./playbackTelemetry";
import type { PlaybackRecovery } from "./playbackRecovery";

interface AudioEventsInput {
  audioRef: RefObject<HTMLAudioElement | null>;
  scrubRef: RefObject<number | null>;
  tracker: ListeningTracker;
  recovery: PlaybackRecovery;
  handleTimeUpdate: () => void;
  handleProgress: () => void;
  setDuration: Dispatch<SetStateAction<number>>;
  setWaiting: Dispatch<SetStateAction<boolean>>;
  handleEnded: () => void;
  handleError: () => void;
  handleWaiting: () => void;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  clearWaitingTimer: () => void;
}

export function useAudioEvents({
  audioRef,
  scrubRef,
  tracker,
  recovery,
  handleTimeUpdate,
  handleProgress,
  setDuration,
  setWaiting,
  handleEnded,
  handleError,
  handleWaiting,
  setIsPlaying,
  clearWaitingTimer,
}: AudioEventsInput) {
  const fromActive = useCallback(
    (event: SyntheticEvent<HTMLAudioElement>) => event.currentTarget === audioRef.current,
    [audioRef],
  );

  const audioProps: ComponentPropsWithoutRef<"audio"> = {
    preload: "auto",
    onTimeUpdate: (event) => fromActive(event) && handleTimeUpdate(),
    onSeeking: (event) => fromActive(event) && tracker.reposition(event.currentTarget.currentTime),
    onProgress: (event) => fromActive(event) && handleProgress(),
    onLoadedMetadata: (event) =>
      fromActive(event) && setDuration(event.currentTarget.duration || 0),
    onDurationChange: (event) =>
      fromActive(event) && setDuration(event.currentTarget.duration || 0),
    onEnded: (event) => {
      if (!fromActive(event)) return;
      setWaiting(false);
      handleEnded();
    },
    onError: (event) => {
      if (!fromActive(event)) return;
      setWaiting(false);
      handleError();
    },
    onLoadStart: (event) => {
      if (!fromActive(event)) return;
      setWaiting(true);
      handleWaiting();
    },
    onWaiting: (event) => {
      if (!fromActive(event)) return;
      setWaiting(true);
      handleWaiting();
    },
    onStalled: (event) => fromActive(event) && handleWaiting(),
    onPlay: (event) => fromActive(event) && setIsPlaying(true),
    onPause: (event) => {
      if (scrubRef.current !== null) return;
      if (
        fromActive(event) &&
        event.currentTarget.dataset.sourceLoading !== "true" &&
        !event.currentTarget.error
      ) {
        clearWaitingTimer();
        setIsPlaying(false);
      }
    },
    onPlaying: (event) => {
      if (!fromActive(event)) return;
      setWaiting(false);
      clearWaitingTimer();
      recovery.playing();
    },
  };

  return audioProps;
}

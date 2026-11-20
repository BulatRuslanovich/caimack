// SPDX-License-Identifier: AGPL-3.0-only

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
  currentTrackId: string | undefined;
  isPlaying: boolean;
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
  currentTrackId,
  isPlaying,
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
    ({ currentTarget }: SyntheticEvent<HTMLAudioElement>) =>
      currentTarget === audioRef.current &&
      currentTrackId !== undefined &&
      currentTarget.dataset.trackId === currentTrackId,
    [audioRef, currentTrackId],
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
      if (
        !isPlaying ||
        !fromActive(event) ||
        !event.currentTarget.ended ||
        event.currentTarget.dataset.sourceLoading === "true"
      )
        return;
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
    // Media events are queued and can be stale by the time they are delivered.
    onPlay: (event) => fromActive(event) && !event.currentTarget.paused && setIsPlaying(true),
    onPause: (event) => {
      if (scrubRef.current !== null) return;
      if (
        fromActive(event) &&
        event.currentTarget.paused &&
        !event.currentTarget.ended &&
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

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { ComponentPropsWithoutRef, Dispatch, RefObject, SetStateAction } from "react";
import type { AdaptivePlayback } from "@/lib/playback/adaptivePlayback";
import type { RepeatMode } from "@/lib/playback/playerTypes";
import type { Track } from "@/lib/types";

export interface PlaybackEngineInput {
  currentTrack: Track | null;
  nextTrack: Track | null;
  crossfade: number;
  smartTransitions: boolean;
  normalizeVolume: boolean;
  repeat: RepeatMode;
  isPlaying: boolean;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  volume: number;
  muted: boolean;
  onTrackEnded: () => void;
}

export interface PlaybackEngine {
  audioRefs: [RefObject<HTMLAudioElement | null>, RefObject<HTMLAudioElement | null>];
  audioProps: ComponentPropsWithoutRef<"audio">;

  position: number;
  duration: number;
  buffered: number;
  buffering: boolean;

  getPosition: () => number;
  getDuration: () => number;
  trackedPosition: () => number;

  seek: (seconds: number) => void;
  seekBy: (deltaSeconds: number) => void;
  scrubBy: (deltaSeconds: number) => void;
  holdScrub: () => void;
  commitScrub: () => void;

  recoverSource: () => boolean;

  startQueue: () => void;
  resetProgress: () => void;
  resumeAt: (trackId: string | undefined, seconds: number) => void;
}

export interface PendingSwitch {
  from: HTMLAudioElement;
  fade: number;
}

export interface Standby {
  trackId: string;
  sourceKey: string;
  playback: AdaptivePlayback;
  ready: boolean;
}

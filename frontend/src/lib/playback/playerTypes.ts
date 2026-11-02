// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

import type { SleepTimer, SleepTimerChoice } from "@/lib/playback/useSleepTimer";
import type { QueueSignals, RadioFocus, RecommendationReason, Track } from "@/lib/types";

export type RepeatMode = "off" | "all" | "one";

export type RadioState = "idle" | "loading" | "empty" | "failed";

export interface RadioSessionState {
  seedTrackId?: string | null;
  mood?: string | null;
  focus?: RadioFocus | null;
  reasons: Record<string, RecommendationReason>;

  signals?: Record<string, QueueSignals>;
  manualTrackIds?: string[];
}

export interface QueueSnapshot {
  queue: Track[];
  order: number[];
  index: number;
  position: number;
  radioFrom: number;
  radioSession: RadioSessionState | null;
}

export interface PlayerState {
  queue: Track[];
  currentTrack: Track | null;
  nextTrack: Track | null;
  currentIndex: number;
  isPlaying: boolean;
  buffering: boolean;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  crossfade: number;
  smartTransitions: boolean;
  normalizeVolume: boolean;
  autoplay: boolean;
  sleepTimer: SleepTimer | null;
  radio: RadioState;
  radioSession: RadioSessionState | null;
}

export interface PlayerNowPlaying {
  currentTrackId: string | null;
  currentAlbumId: string | null;
  isPlaying: boolean;
}

export interface PlayerActions {
  playQueue: (tracks: Track[], startIndex?: number, options?: { shuffle?: boolean }) => void;
  playTrack: (track: Track, contextTracks?: Track[]) => void;
  toggle: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  seekBy: (deltaSeconds: number) => void;
  scrubBy: (deltaSeconds: number) => void;
  holdScrub: () => void;
  commitScrub: () => void;

  getDuration: () => number;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  setShuffle: (enabled: boolean) => void;
  cycleRepeat: () => void;
  setCrossfade: (seconds: number) => void;
  setSmartTransitions: (enabled: boolean) => void;
  setNormalizeVolume: (enabled: boolean) => void;
  setSleepTimer: (choice: SleepTimerChoice) => void;
  setAutoplay: (enabled: boolean) => void;
  addToQueue: (track: Track) => void;
  playNext: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  moveInQueue: (from: number, to: number) => void;
  clearQueue: () => void;
  jumpTo: (index: number) => void;
  patchTrack: (trackId: string, changes: Partial<Track>) => void;
  snapshotQueue: () => QueueSnapshot;
  restoreQueue: (snapshot: QueueSnapshot) => void;
  startRadio: (seedTrack?: Track | null, mood?: string | null) => Promise<boolean>;
  setRadioFocus: (focus: RadioFocus) => void;
  continueHere: () => Promise<boolean>;
}

export interface PlayerProgress {
  position: number;
  duration: number;
  buffered: number;

  getPosition: () => number;
}

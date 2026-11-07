// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type {
  PlayerActions,
  PlayerProgress,
  PlayerState,
  RadioSessionState,
  RepeatMode,
} from "./playerTypes";
import type { SleepTimer } from "./useSleepTimer";
import type { RadioFocus, Track } from "@/lib/types";
import { sourceOf } from "./playSource";

export interface ConnectDevice {
  id: string;
  name: string;
  connectionId: string;
  kind?: "web" | "android";
}

export interface ConnectPlayback {
  deviceId: string;
  queueRevision: number;
  reportedAt: string;
  trackIds: string[];
  index: number;
  order: number[];
  positionSeconds: number;
  isPlaying: boolean;
  buffering: boolean;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  radio: RadioSessionState | null;
  crossfade: number;
  smartTransitions: boolean;
  normalizeVolume: boolean;
  autoplay: boolean;
  sleepTimer: SleepTimer | null;
}

export interface ConnectSnapshot {
  epoch: string;
  version: number;
  devices: ConnectDevice[];
  playback: ConnectPlayback | null;
}

export type ConnectCommand =
  | { type: "setPlaying"; playing: boolean }
  | { type: "next" | "previous" | "clear" | "clearUpcoming" }
  | { type: "seek"; positionSeconds: number }
  | { type: "setVolume"; volume: number }
  | { type: "setMuted"; muted: boolean }
  | { type: "setShuffle"; shuffle: boolean }
  | { type: "setRepeat"; repeat: RepeatMode }
  | {
      type: "play";
      trackIds: string[];
      index: number;
      positionSeconds: number;
      playing: boolean;
      shuffle: boolean;
      repeat: RepeatMode;
      source?: string | null;
      order?: number[];
      radio?: RadioSessionState | null;
    }
  | { type: "enqueue"; trackId: string; next: boolean }
  | { type: "remove" | "jump"; index: number; trackId: string }
  | { type: "move"; from: number; to: number; trackId: string }
  | { type: "startRadio"; seedTrackId: string | null }
  | { type: "setRadioFocus"; focus: RadioFocus }
  | { type: "setCrossfade"; seconds: number }
  | { type: "setSmartTransitions" | "setNormalizeVolume" | "setAutoplay"; enabled: boolean }
  | { type: "setSleepTimer"; minutes: number | null; trackEnd: boolean };

export interface ConnectEnvelope {
  id: string;
  connectionId: string;
  expiresAt: string;
  queueRevision: number | null;
  command: ConnectCommand;
}

export type SendCommand = (command: ConnectCommand, queueRevision?: number) => Promise<void>;

export function remoteState(active: ConnectPlayback, tracks: Track[]): PlayerState {
  const next =
    active.order[active.order.indexOf(active.index) + 1] ??
    (active.repeat === "all" ? active.order[0] : -1);
  return {
    queue: tracks,
    queueOrder: active.order,
    currentIndex: active.index,
    currentTrack: tracks[active.index] ?? null,
    nextTrack: tracks[next] ?? null,
    isPlaying: active.isPlaying,
    buffering: active.buffering,
    volume: active.volume,
    muted: active.muted,
    shuffle: active.shuffle,
    repeat: active.repeat,
    crossfade: active.crossfade,
    smartTransitions: active.smartTransitions,
    normalizeVolume: active.normalizeVolume,
    autoplay: active.autoplay,
    sleepTimer: active.sleepTimer,
    radio: "idle",
    radioSession: active.radio,
  };
}

/** Route the existing player's controls without ever invoking the local audio engine. */
export function remoteActions(
  state: PlayerState,
  progress: PlayerProgress,
  queueRevision: number,
  send: SendCommand,
  continueHere: () => Promise<boolean>,
  patchTrack: PlayerActions["patchTrack"],
): PlayerActions {
  const sendNow = (command: ConnectCommand, revision?: number) => {
    void send(command, revision).catch(() => {});
  };
  const playQueue: PlayerActions["playQueue"] = (tracks, index = 0, options = {}) => {
    if (!tracks.length) return;
    sendNow({
      type: "play",
      trackIds: tracks.map((track) => track.id),
      index: Math.max(0, Math.min(index, tracks.length - 1)),
      positionSeconds: 0,
      playing: true,
      shuffle: options.shuffle ?? state.shuffle,
      repeat: state.repeat,
      source: sourceOf(tracks[index]?.id),
    });
  };
  const seek = (seconds: number) =>
    sendNow({ type: "seek", positionSeconds: Math.max(0, Math.min(seconds, progress.duration)) });
  return {
    playQueue,
    playTrack: (track, context) => {
      const tracks = context?.length ? context : [track];
      playQueue(
        tracks,
        Math.max(
          0,
          tracks.findIndex((item) => item.id === track.id),
        ),
      );
    },
    toggle: () => sendNow({ type: "setPlaying", playing: !state.isPlaying }),
    pause: () => sendNow({ type: "setPlaying", playing: false }),
    next: () => sendNow({ type: "next" }),
    previous: () => sendNow({ type: "previous" }),
    seek,
    seekBy: (delta) => seek(progress.getPosition() + delta),
    scrubBy: (delta) => seek(progress.getPosition() + delta),
    holdScrub: () => {},
    commitScrub: () => {},
    getDuration: () => progress.duration,
    setVolume: (volume) => sendNow({ type: "setVolume", volume: Math.max(0, Math.min(1, volume)) }),
    toggleMute: () => sendNow({ type: "setMuted", muted: !state.muted }),
    toggleShuffle: () => sendNow({ type: "setShuffle", shuffle: !state.shuffle }),
    setShuffle: (shuffle) => sendNow({ type: "setShuffle", shuffle }),
    cycleRepeat: () =>
      sendNow({
        type: "setRepeat",
        repeat: state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off",
      }),
    setCrossfade: (seconds) => sendNow({ type: "setCrossfade", seconds }),
    setSmartTransitions: (enabled) => sendNow({ type: "setSmartTransitions", enabled }),
    setNormalizeVolume: (enabled) => sendNow({ type: "setNormalizeVolume", enabled }),
    setAutoplay: (enabled) => sendNow({ type: "setAutoplay", enabled }),
    setSleepTimer: (choice) =>
      sendNow({
        type: "setSleepTimer",
        minutes: typeof choice === "number" ? choice : null,
        trackEnd: choice === "trackEnd",
      }),
    addToQueue: (track) => sendNow({ type: "enqueue", trackId: track.id, next: false }),
    playNext: (track) => sendNow({ type: "enqueue", trackId: track.id, next: true }),
    removeFromQueue: (index) => {
      const track = state.queue[index];
      if (track) sendNow({ type: "remove", index, trackId: track.id }, queueRevision);
    },
    jumpTo: (index) => {
      const track = state.queue[index];
      if (track) sendNow({ type: "jump", index, trackId: track.id }, queueRevision);
    },
    moveInQueue: (from, to) => {
      const track = state.queue[from];
      if (track) sendNow({ type: "move", from, to, trackId: track.id }, queueRevision);
    },
    clearQueue: () => sendNow({ type: "clear" }),
    patchTrack,
    snapshotQueue: () => ({
      queue: state.queue,
      order: state.queueOrder,
      index: state.currentIndex,
      position: progress.getPosition(),
      radioFrom: state.queue.length,
      radioSession: state.radioSession,
    }),
    restoreQueue: (snapshot) => {
      if (snapshot.queue.length)
        sendNow({
          type: "play",
          trackIds: snapshot.queue.map((track) => track.id),
          index: snapshot.index,
          positionSeconds: snapshot.position,
          playing: state.isPlaying,
          shuffle: state.shuffle,
          repeat: state.repeat,
          order: snapshot.order,
          radio: snapshot.radioSession,
        });
    },
    startRadio: async (seed) => {
      try {
        await send({ type: "startRadio", seedTrackId: seed?.id ?? null });
        return true;
      } catch {
        return false;
      }
    },
    setRadioFocus: (focus) => sendNow({ type: "setRadioFocus", focus }),
    continueHere,
  };
}

export function positionAt(
  active: ConnectPlayback,
  receivedAt: number,
  now: number,
  duration: number,
  online: boolean,
): number {
  const elapsed =
    online && active.isPlaying && !active.buffering ? Math.max(0, now - receivedAt) / 1000 : 0;
  return Math.max(0, Math.min(active.positionSeconds + elapsed, duration));
}

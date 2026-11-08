// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import React, {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/api";
import { deviceId, recordEvent } from "@/lib/events";
import { radioSource, sourceOf, tagSource, usePlaySource } from "@/lib/playback/playSource";
import { useRequiredContext } from "@/lib/useRequiredContext";
import { advanceIn, buildOrder } from "@/lib/playback/playerQueue";
import type {
  PlayerActions,
  PlayerNowPlaying,
  PlayerProgress,
  PlayerState,
  QueueSnapshot,
  RepeatMode,
} from "@/lib/playback/playerTypes";
import type { PlaybackHandoff, Track } from "@/lib/types";
import {
  connectEqualizer,
  enableVinylScratch,
  prepareVinylScratch,
} from "@/lib/playback/equalizer";
import { useTatarMafia } from "@/lib/tatarMafia";
import { useRadioSession } from "@/lib/playback/useRadioSession";
import { usePlaybackEngine } from "@/lib/playback/usePlaybackEngine";
import { useExclusivePlayback } from "@/lib/playback/useExclusivePlayback";
import { useMediaSession } from "@/lib/playback/useMediaSession";
import { ConnectContext, useConnectPlayback } from "@/lib/playback/useConnectPlayback";
import { readPersistedPlayer, usePersistedPlayer } from "@/lib/playback/usePlayerStorage";
import { useQueueEditing } from "@/lib/playback/useQueueEditing";
import { useSleepTimer } from "@/lib/playback/useSleepTimer";
import { useT } from "./I18nContext";
import { useAuth } from "./AuthContext";
import { useToast } from "@/lib/useToast";

export type { RepeatMode } from "@/lib/playback/playerTypes";

const PlayerStateContext = createContext<PlayerState | null>(null);

const PlayerActionsContext = createContext<PlayerActions | null>(null);

const PlayerProgressContext = createContext<PlayerProgress | null>(null);

const PlayerNowPlayingContext = createContext<PlayerNowPlaying | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  return (
    <PlayerSessionProvider key={userId ?? "signed-out"} userId={userId}>
      {children}
    </PlayerSessionProvider>
  );
}

function PlayerSessionProvider({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId: string | null;
}) {
  const tatarMafia = useTatarMafia();
  const { notify, notifyError } = useToast();
  const t = useT();

  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [crossfade, setCrossfade] = useState(0);
  const [smartTransitions, setSmartTransitions] = useState(true);
  const [normalizeVolume, setNormalizeVolume] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [restored, setRestored] = useState(false);
  const [localOutput, setLocalOutput] = useState(true);

  const orderRef = useRef<number[]>([]);
  const queueRef = useRef<Track[]>([]);

  const [order, setOrder] = useState<number[]>([]);

  const applyQueue = useCallback((next: Track[], nextOrder: number[]) => {
    queueRef.current = next;
    orderRef.current = nextOrder;
    setQueue(next);
    setOrder(nextOrder);
  }, []);

  const currentTrack = currentIndex >= 0 ? (queue[currentIndex] ?? null) : null;

  const nextTrack = useMemo<Track | null>(() => {
    const step = advanceIn(order, currentIndex, 1, repeat === "all");
    return step.kind === "play" ? (queue[step.index] ?? null) : null;
  }, [order, queue, currentIndex, repeat]);

  const trackEnded = useRef(() => {});
  const onTrackEnded = useCallback(() => trackEnded.current(), []);

  const sleep = useSleepTimer(() => setIsPlaying(false));
  const stopsAtTrackEnd = sleep.timer?.kind === "trackEnd";

  const {
    session: radioSession,
    radio,
    start: startRadioSession,
    stop: stopRadioSession,
    setFocus: setRadioFocus,
    pin: pinRadioTrack,
    resetRadio,
    restore: restoreRadioSession,
    noteInsert: noteRadioInsert,
    radioFrom,
  } = useRadioSession({
    queue,
    currentIndex,
    repeat,
    autoplay: autoplay && localOutput,
    queueRef,
    orderRef,
    applyQueue,
    setCurrentIndex,
  });

  const {
    audioRefs: [primaryAudioRef, secondaryAudioRef],
    audioProps,
    position,
    duration,
    buffered,
    buffering,
    getPosition,
    trackedPosition,
    seek,
    seekBy,
    scrubBy,
    holdScrub,
    commitScrub,
    getDuration,
    recoverSource,
    startQueue,
    resetProgress,
    resumeAt,
  } = usePlaybackEngine({
    currentTrack: localOutput ? currentTrack : null,
    nextTrack: stopsAtTrackEnd || !localOutput ? null : nextTrack,
    crossfade,
    smartTransitions,
    normalizeVolume,
    repeat,
    isPlaying: isPlaying && localOutput,
    setIsPlaying,
    volume: volume * sleep.gain,
    muted,
    onTrackEnded,
  });

  const live = useRef({ currentIndex, shuffle, repeat, radioSession });
  useLayoutEffect(() => {
    live.current = { currentIndex, shuffle, repeat, radioSession };
  });

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const saved = readPersistedPlayer(userId);
    if (saved) {
      applyQueue(
        saved.queue,
        saved.queue.map((_, index) => index),
      );
      if (saved.index >= 0) {
        setCurrentIndex(saved.index);
        resumeAt(saved.queue[saved.index].id, saved.position);
      }

      setVolumeState(saved.volume);
      setMuted(saved.muted);
      setShuffle(saved.shuffle);
      setRepeat(saved.repeat);
      setCrossfade(saved.crossfade);
      setSmartTransitions(saved.smartTransitions);
      setNormalizeVolume(saved.normalizeVolume);
      setAutoplay(saved.autoplay);
      if (saved.radioSession) restoreRadioSession(saved.radioSession);
    }

    setRestored(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [userId, applyQueue, restoreRadioSession, resumeAt]);

  usePersistedPlayer(
    userId,
    {
      queue,
      index: currentIndex,
      position,
      volume,
      muted,
      shuffle,
      repeat,
      crossfade,
      smartTransitions,
      normalizeVolume,
      autoplay,
      radioSession,
    },
    restored,
    isPlaying,
  );

  useEffect(() => {
    connectEqualizer(
      [primaryAudioRef.current, secondaryAudioRef.current].filter(
        (element): element is HTMLAudioElement => element !== null,
      ),
    );
  }, [primaryAudioRef, secondaryAudioRef]);

  useEffect(() => {
    enableVinylScratch(tatarMafia);
    if (!tatarMafia) return;
    const prepare = () => void prepareVinylScratch();
    window.addEventListener("pointerdown", prepare, { capture: true, once: true });
    window.addEventListener("keydown", prepare, { capture: true, once: true });
    return () => {
      window.removeEventListener("pointerdown", prepare, true);
      window.removeEventListener("keydown", prepare, true);
      enableVinylScratch(false);
    };
  }, [tatarMafia]);

  const replaceQueue = useCallback(
    (tracks: Track[], startIndex = 0, shuffled = live.current.shuffle) => {
      if (tracks.length === 0) return;

      const safeIndex = Math.min(Math.max(startIndex, 0), tracks.length - 1);

      startQueue();
      resetRadio();

      applyQueue(tracks, buildOrder(tracks.length, shuffled, safeIndex));
      setShuffle(shuffled);
      setCurrentIndex(safeIndex);
      setIsPlaying(true);
    },
    [applyQueue, resetRadio, startQueue],
  );

  const playQueue = useCallback(
    (tracks: Track[], startIndex = 0, options: { shuffle?: boolean } = {}) => {
      stopRadioSession();
      replaceQueue(tracks, startIndex, options.shuffle);
    },
    [replaceQueue, stopRadioSession],
  );

  const playTrack = useCallback(
    (track: Track, contextTracks?: Track[]) => {
      if (contextTracks && contextTracks.length > 0) {
        const index = contextTracks.findIndex((candidate) => candidate.id === track.id);
        playQueue(contextTracks, index >= 0 ? index : 0);
        return;
      }

      playQueue([track], 0);
    },
    [playQueue],
  );

  const advance = useCallback(
    (direction: 1 | -1, { auto = false }: { auto?: boolean } = {}) => {
      const { currentIndex, repeat } = live.current;
      const step = advanceIn(orderRef.current, currentIndex, direction, repeat === "all");

      switch (step.kind) {
        case "none":
          return;

        case "restart":
          seek(0);
          return;

        case "stop":
          setIsPlaying(false);
          if (auto) seek(0);
          return;

        case "play":
          setCurrentIndex(step.index);
          resetProgress();
          setIsPlaying(true);
      }
    },
    [resetProgress, seek],
  );

  const { choose: chooseSleepTimer } = sleep;

  useEffect(() => {
    trackEnded.current = () => {
      if (!stopsAtTrackEnd) {
        advance(1, { auto: true });
        return;
      }

      chooseSleepTimer(null);
      setIsPlaying(false);

      const step = advanceIn(orderRef.current, currentIndex, 1, repeat === "all");
      if (step.kind === "play") {
        setCurrentIndex(step.index);
        resetProgress();
      } else {
        seek(0);
      }
    };
  }, [advance, chooseSleepTimer, currentIndex, repeat, resetProgress, seek, stopsAtTrackEnd]);

  const startRadio = useCallback(
    async (seedTrack?: Track | null, signal?: AbortSignal) => {
      const tracks = await startRadioSession(seedTrack, signal);
      if (tracks) {
        tagSource(
          tracks.filter((track) => track.id !== seedTrack?.id).map((track) => track.id),
          radioSource(Boolean(seedTrack)),
        );
        replaceQueue(tracks, 0);
      }
      return tracks !== null;
    },
    [replaceQueue, startRadioSession],
  );

  const next = useCallback(() => advance(1), [advance]);
  const previous = useCallback(() => {
    const position = getPosition();
    const current = live.current;
    const replay = (index: number) => {
      const track = queueRef.current[index];
      if (track && sourceOf(track.id)?.startsWith("radio")) {
        recordEvent({
          type: "trackReplayed",
          trackId: track.id,
          durationSeconds: track.durationSeconds,
          source: sourceOf(track.id),
        });
      }
    };
    if (position > 3) {
      if (position >= 30) replay(current.currentIndex);
      seek(0);
      return;
    }
    const step = advanceIn(orderRef.current, current.currentIndex, -1, current.repeat === "all");
    if (step.kind === "play") replay(step.index);
    advance(-1);
  }, [advance, getPosition, seek]);

  const toggle = useCallback(() => {
    if (!queueRef.current[live.current.currentIndex]) return;

    recoverSource();
    setIsPlaying((playing) => !playing);
  }, [recoverSource]);

  const play = useCallback(() => {
    recoverSource();
    setIsPlaying(true);
  }, [recoverSource]);
  const pause = useCallback(() => setIsPlaying(false), []);

  const setVolume = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(1, next));
    setVolumeState(clamped);
    if (clamped > 0) setMuted(false);
  }, []);

  const toggleMute = useCallback(() => setMuted((value) => !value), []);

  const toggleShuffle = useCallback(() => {
    const { currentIndex, shuffle } = live.current;
    const nowShuffled = !shuffle;

    applyQueue(queueRef.current, buildOrder(queueRef.current.length, nowShuffled, currentIndex));
    setShuffle(nowShuffled);
  }, [applyQueue]);

  const setShuffleMode = useCallback(
    (enabled: boolean) => {
      if (live.current.shuffle !== enabled) toggleShuffle();
    },
    [toggleShuffle],
  );

  const cycleRepeat = useCallback(() => {
    setRepeat((mode) => (mode === "off" ? "all" : mode === "all" ? "one" : "off"));
  }, []);

  const { addToQueue, playNext, removeFromQueue, moveInQueue, patchTrack } = useQueueEditing({
    pinRadioTrack,
    queueRef,
    orderRef,
    live,
    applyQueue,
    setCurrentIndex,
    noteRadioInsert,
  });

  const snapshotQueue = useCallback(
    (): QueueSnapshot => ({
      queue: queueRef.current,
      order: [...orderRef.current],
      index: live.current.currentIndex,
      position: trackedPosition(),
      radioFrom: radioFrom(),
      radioSession: live.current.radioSession,
    }),
    [radioFrom, trackedPosition],
  );

  const restoreQueue = useCallback(
    (snapshot: QueueSnapshot) => {
      resumeAt(snapshot.queue[snapshot.index]?.id, snapshot.position);
      restoreRadioSession(snapshot.radioSession, snapshot.radioFrom);

      applyQueue(snapshot.queue, snapshot.order);
      setCurrentIndex(snapshot.index);
    },
    [applyQueue, restoreRadioSession, resumeAt],
  );

  const clearQueue = useCallback(() => {
    stopRadioSession();
    resetRadio();

    applyQueue([], []);
    setCurrentIndex(-1);
    setIsPlaying(false);
    resetProgress();
  }, [applyQueue, resetProgress, resetRadio, stopRadioSession]);

  const jumpTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= queueRef.current.length) return;

      setCurrentIndex(index);
      resetProgress();
      setIsPlaying(true);
    },
    [resetProgress],
  );

  const takeOver = useCallback(
    (handoff: PlaybackHandoff, playing = true) => {
      const { tracks, index, positionSeconds } = handoff;
      const target = tracks[index];
      if (!target) return;

      const sameTrack = queueRef.current[live.current.currentIndex]?.id === target.id;

      stopRadioSession();
      startQueue();
      resetRadio();

      applyQueue(tracks, buildOrder(tracks.length, handoff.shuffle, index));
      setShuffle(handoff.shuffle);
      setRepeat(handoff.repeat);
      setCurrentIndex(index);

      if (sameTrack) seek(positionSeconds);
      else resumeAt(target.id, positionSeconds);

      setIsPlaying(playing);
    },
    [applyQueue, resetRadio, resumeAt, seek, startQueue, stopRadioSession],
  );

  const continueHere = useCallback(async () => {
    try {
      takeOver(await api.handoff(deviceId()));
      return true;
    } catch (error) {
      notifyError(error);
      return false;
    }
  }, [notifyError, takeOver]);

  const state = useMemo<PlayerState>(
    () => ({
      queue,
      queueOrder: order,
      currentTrack,
      nextTrack,
      currentIndex,
      isPlaying,
      buffering,
      volume,
      muted,
      shuffle,
      repeat,
      crossfade,
      smartTransitions,
      normalizeVolume,
      autoplay,
      sleepTimer: sleep.timer,
      radio,
      radioSession,
    }),
    [
      queue,
      order,
      currentTrack,
      nextTrack,
      currentIndex,
      isPlaying,
      buffering,
      volume,
      muted,
      shuffle,
      repeat,
      crossfade,
      smartTransitions,
      normalizeVolume,
      autoplay,
      sleep.timer,
      radio,
      radioSession,
    ],
  );

  const actions = useMemo<PlayerActions>(
    () => ({
      playQueue,
      playTrack,
      toggle,
      pause,
      next,
      previous,
      seek,
      seekBy,
      scrubBy,
      holdScrub,
      commitScrub,
      getDuration,
      setVolume,
      toggleMute,
      toggleShuffle,
      setShuffle: setShuffleMode,
      cycleRepeat,
      setCrossfade,
      setSmartTransitions,
      setNormalizeVolume,
      setSleepTimer: chooseSleepTimer,
      setAutoplay,
      addToQueue,
      playNext,
      removeFromQueue,
      moveInQueue,
      clearQueue,
      jumpTo,
      patchTrack,
      snapshotQueue,
      restoreQueue,
      startRadio,
      setRadioFocus,
      continueHere,
    }),
    [
      playQueue,
      playTrack,
      toggle,
      pause,
      next,
      previous,
      seek,
      seekBy,
      scrubBy,
      holdScrub,
      commitScrub,
      getDuration,
      setVolume,
      toggleMute,
      toggleShuffle,
      setShuffleMode,
      cycleRepeat,
      setCrossfade,
      setSmartTransitions,
      setNormalizeVolume,
      chooseSleepTimer,
      setAutoplay,
      addToQueue,
      playNext,
      removeFromQueue,
      moveInQueue,
      clearQueue,
      jumpTo,
      patchTrack,
      snapshotQueue,
      restoreQueue,
      startRadio,
      setRadioFocus,
      continueHere,
    ],
  );

  const progress = useMemo<PlayerProgress>(
    () => ({ position, duration, buffered, getPosition }),
    [position, duration, buffered, getPosition],
  );

  const output = useCallback(
    (enabled: boolean) => {
      setLocalOutput(enabled);
      if (!enabled) {
        setIsPlaying(false);
        stopRadioSession();
        chooseSleepTimer(null);
      }
    },
    [stopRadioSession, chooseSleepTimer],
  );
  const load = useCallback(
    (
      tracks: Track[],
      command: Extract<import("@/lib/playback/connect").ConnectCommand, { type: "play" }>,
    ) => {
      takeOver(
        {
          deviceId: deviceId(),
          deviceName: "",
          tracks,
          index: command.index,
          positionSeconds: command.positionSeconds,
          shuffle: command.shuffle,
          repeat: command.repeat,
        },
        command.playing,
      );
      if (command.order) applyQueue(tracks, command.order);
      if (command.radio) {
        restoreRadioSession(command.radio);
        tagSource(
          Object.keys(command.radio.reasons),
          radioSource(Boolean(command.radio.seedTrackId)),
        );
      }
    },
    [takeOver, applyQueue, restoreRadioSession],
  );
  const connected = useConnectPlayback(userId, state, actions, progress, output, load);

  useExclusivePlayback(connected.shouldHold, {
    onClaimed: () => {
      connected.claimed();
      void connected.report().catch(() => {});
    },
    onDisplaced: (takeover) => {
      setIsPlaying(false);
      connected.displaced();
      notify(
        t(takeover?.deviceName ? "player.playingOn" : "player.playingElsewhere", {
          device: takeover?.deviceName ?? "",
        }),
        "info",
      );
    },
  });
  useMediaSession(
    connected.state.currentTrack,
    connected.state.isPlaying,
    connected.progress.duration,
    {
      play: connected.controls.selectedId
        ? () => {
            if (!connected.state.isPlaying) connected.actions.toggle();
          }
        : play,
      pause: connected.actions.pause,
      next: connected.actions.next,
      previous: connected.actions.previous,
      seek: connected.actions.seek,
      seekBy: connected.actions.seekBy,
      getPosition: connected.progress.getPosition,
    },
  );

  const currentTrackId = connected.state.currentTrack?.id ?? null;
  const currentAlbumId = connected.state.currentTrack?.albumId ?? null;
  const displayedPlaying = connected.state.isPlaying;

  const nowPlaying = useMemo<PlayerNowPlaying>(
    () => ({ currentTrackId, currentAlbumId, isPlaying: displayedPlaying }),
    [currentTrackId, currentAlbumId, displayedPlaying],
  );

  return (
    <ConnectContext.Provider value={connected.controls}>
      <PlayerStateContext.Provider value={connected.state}>
        <PlayerActionsContext.Provider value={connected.actions}>
          <PlayerNowPlayingContext.Provider value={nowPlaying}>
            <PlayerProgressContext.Provider value={connected.progress}>
              {children}
            </PlayerProgressContext.Provider>
          </PlayerNowPlayingContext.Provider>
          <audio ref={primaryAudioRef} {...audioProps} />
          <audio ref={secondaryAudioRef} {...audioProps} />
        </PlayerActionsContext.Provider>
      </PlayerStateContext.Provider>
    </ConnectContext.Provider>
  );
}

export function usePlayerState(): PlayerState {
  return useRequiredContext(PlayerStateContext, "usePlayerState", "PlayerProvider");
}

export function usePlayerActions(): PlayerActions {
  const actions = useRequiredContext(PlayerActionsContext, "usePlayerActions", "PlayerProvider");
  const source = usePlaySource();

  return useMemo(
    () => ({
      ...actions,
      playTrack: (track: Track, contextTracks?: Track[]) => {
        tagSource(
          (contextTracks ?? [track]).map((item) => item.id),
          source,
        );
        actions.playTrack(track, contextTracks);
      },
      playQueue: (tracks: Track[], startIndex?: number) => {
        tagSource(
          tracks.map((track) => track.id),
          source,
        );
        actions.playQueue(tracks, startIndex);
      },
    }),
    [actions, source],
  );
}

export function usePlayer(): PlayerState & PlayerActions {
  const state = usePlayerState();
  const actions = usePlayerActions();
  return useMemo(() => ({ ...state, ...actions }), [state, actions]);
}

export function usePlayerProgress(): PlayerProgress {
  return useRequiredContext(PlayerProgressContext, "usePlayerProgress", "PlayerProvider");
}

export function useNowPlaying(): PlayerNowPlaying {
  return useRequiredContext(PlayerNowPlayingContext, "useNowPlaying", "PlayerProvider");
}

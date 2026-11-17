// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { api } from "@/lib/api";
import { deviceId, recordEvent } from "@/lib/events";
import { connectEqualizer } from "@/lib/playback/equalizer";
import {
  advanceIn,
  materializeQueue,
  restorePlaybackOrder,
  selectQueueEntry,
  startPlaybackQueue,
} from "@/lib/playback/playerQueue";
import { queueEntries } from "@/lib/playback/queueEntries";
import type {
  PlayerActions,
  PlayerNowPlaying,
  PlayerProgress,
  PlayerState,
  QueueSnapshot,
} from "@/lib/playback/playerTypes";
import { radioSource, sourceOf, tagSource, usePlaySource } from "@/lib/playback/playSource";
import { ConnectContext, useConnectPlayback } from "@/lib/playback/useConnectPlayback";
import { usePlaybackEngine } from "@/lib/playback/usePlaybackEngine";
import { usePlaybackPreferences } from "@/lib/playback/usePlaybackPreferences";
import { useArtworkNavigation, type ArtworkDirection } from "@/lib/playback/useArtworkNavigation";
import { usePlayerPlatform } from "@/lib/playback/usePlayerPlatform";
import { usePlayerSession } from "@/lib/playback/usePlayerSession";
import { useQueueEditing } from "@/lib/playback/useQueueEditing";
import { useQueueState } from "@/lib/playback/useQueueState";
import { useRadioSession } from "@/lib/playback/useRadioSession";
import { useSleepTimer } from "@/lib/playback/useSleepTimer";
import type { PlaybackHandoff, Track } from "@/lib/types";
import { useRequiredContext } from "@/lib/useRequiredContext";
import { useToast } from "@/lib/useToast";
import React, {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "./AuthContext";

export type { RepeatMode } from "@/lib/playback/playerTypes";

const PlayerStateContext = createContext<PlayerState | null>(null);

const PlayerActionsContext = createContext<PlayerActions | null>(null);

const PlayerProgressContext = createContext<PlayerProgress | null>(null);

const PlayerClockContext = createContext<PlayerProgress["getPosition"] | null>(null);

const PlayerNowPlayingContext = createContext<PlayerNowPlaying | null>(null);
const PlayerQueueContext = createContext<Track[] | null>(null);
const ArtworkDirectionContext = createContext<ArtworkDirection>("next");

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
  const { notifyError } = useToast();

  const {
    queue,
    order,
    currentIndex,
    setCurrentIndex,
    shuffle,
    setShuffle,
    repeat,
    setRepeat,
    queueRef,
    orderRef,
    originalQueueRef,
    applyQueue,
    currentTrack,
    nextTrack,
    restoreSession,
  } = useQueueState();
  const [isPlaying, setIsPlaying] = useState(false);
  const {
    volume,
    setVolumeState,
    muted,
    setMuted,
    crossfade,
    setCrossfade,
    smartTransitions,
    setSmartTransitions,
    normalizeVolume,
    setNormalizeVolume,
    autoplay,
    setAutoplay,
    restorePreferences,
  } = usePlaybackPreferences();
  const [localOutput, setLocalOutput] = useState(true);

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

  usePlayerSession(
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
    isPlaying,
    {
      restoreQueue: restoreSession,
      restorePreferences,
      restoreRadio: restoreRadioSession,
      resumeAt,
    },
  );

  useEffect(() => {
    connectEqualizer(
      [primaryAudioRef.current, secondaryAudioRef.current].filter(
        (element): element is HTMLAudioElement => element !== null,
      ),
    );
  }, [primaryAudioRef, secondaryAudioRef]);

  const replaceQueue = useCallback(
    (tracks: Track[], startIndex = 0, shuffled = live.current.shuffle) => {
      if (tracks.length === 0) return;

      const safeIndex = Math.min(Math.max(startIndex, 0), tracks.length - 1);

      startQueue();
      resetRadio();

      originalQueueRef.current = queueEntries(tracks);
      const next = startPlaybackQueue(originalQueueRef.current, safeIndex, shuffled);
      applyQueue(next.queue, next.order);
      setShuffle(shuffled);
      setCurrentIndex(next.index);
      setIsPlaying(true);
    },
    [applyQueue, originalQueueRef, resetRadio, setCurrentIndex, setShuffle, startQueue],
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
    [orderRef, resetProgress, seek, setCurrentIndex],
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
  }, [
    advance,
    chooseSleepTimer,
    currentIndex,
    orderRef,
    repeat,
    resetProgress,
    seek,
    setCurrentIndex,
    stopsAtTrackEnd,
  ]);

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
  }, [advance, getPosition, orderRef, queueRef, seek]);

  const toggle = useCallback(() => {
    if (!queueRef.current[live.current.currentIndex]) return;

    recoverSource();
    setIsPlaying((playing) => !playing);
  }, [queueRef, recoverSource]);

  const play = useCallback(() => {
    recoverSource();
    setIsPlaying(true);
  }, [recoverSource]);
  const pause = useCallback(() => setIsPlaying(false), []);

  const setVolume = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(1, next));
      setVolumeState(clamped);
      if (clamped > 0) setMuted(false);
    },
    [setMuted, setVolumeState],
  );

  const toggleMute = useCallback(() => setMuted((value) => !value), [setMuted]);

  const toggleShuffle = useCallback(() => {
    const { currentIndex, shuffle } = live.current;
    const nowShuffled = !shuffle;

    if (nowShuffled) originalQueueRef.current = queueRef.current;
    const next = nowShuffled
      ? startPlaybackQueue(queueRef.current, currentIndex, true)
      : restorePlaybackOrder(queueRef.current, currentIndex, originalQueueRef.current);
    applyQueue(next.queue, next.order);
    setCurrentIndex(next.index);
    setShuffle(nowShuffled);
  }, [applyQueue, originalQueueRef, queueRef, setCurrentIndex, setShuffle]);

  const setShuffleMode = useCallback(
    (enabled: boolean) => {
      if (live.current.shuffle !== enabled) toggleShuffle();
    },
    [toggleShuffle],
  );

  const cycleRepeat = useCallback(() => {
    setRepeat((mode) => (mode === "off" ? "all" : mode === "all" ? "one" : "off"));
  }, [setRepeat]);

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
    [orderRef, queueRef, radioFrom, trackedPosition],
  );

  const restoreQueue = useCallback(
    (snapshot: QueueSnapshot) => {
      resumeAt(snapshot.queue[snapshot.index]?.id, snapshot.position);
      restoreRadioSession(snapshot.radioSession, snapshot.radioFrom);

      const next = materializeQueue(snapshot.queue, snapshot.order, snapshot.index);
      applyQueue(next.queue, next.order);
      setCurrentIndex(next.index);
    },
    [applyQueue, restoreRadioSession, resumeAt, setCurrentIndex],
  );

  const clearQueue = useCallback(() => {
    stopRadioSession();
    resetRadio();

    applyQueue([], []);
    originalQueueRef.current = [];
    setCurrentIndex(-1);
    setIsPlaying(false);
    resetProgress();
  }, [applyQueue, originalQueueRef, resetProgress, resetRadio, setCurrentIndex, stopRadioSession]);

  const jumpTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= queueRef.current.length) return;

      const next = selectQueueEntry(queueRef.current, live.current.currentIndex, index);
      applyQueue(next.queue, next.order);
      setCurrentIndex(next.index);
      resetProgress();
      setIsPlaying(true);
    },
    [applyQueue, queueRef, resetProgress, setCurrentIndex],
  );

  const takeOver = useCallback(
    (handoff: PlaybackHandoff, playing = true, original: Track[] = handoff.tracks) => {
      const { tracks, index, positionSeconds } = handoff;
      const target = tracks[index];
      if (!target) return;

      const sameTrack = queueRef.current[live.current.currentIndex]?.id === target.id;

      stopRadioSession();
      startQueue();
      resetRadio();

      originalQueueRef.current = original;
      applyQueue(
        tracks,
        tracks.map((_, position) => position),
      );
      setShuffle(handoff.shuffle);
      setRepeat(handoff.repeat);
      setCurrentIndex(index);

      if (sameTrack) seek(positionSeconds);
      else resumeAt(target.id, positionSeconds);

      setIsPlaying(playing);
    },
    [
      applyQueue,
      originalQueueRef,
      queueRef,
      resetRadio,
      resumeAt,
      seek,
      setCurrentIndex,
      setRepeat,
      setShuffle,
      startQueue,
      stopRadioSession,
    ],
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
      const original = queueEntries(tracks);
      const next = command.order
        ? materializeQueue(original, command.order, command.index)
        : startPlaybackQueue(original, command.index, command.shuffle);
      takeOver(
        {
          deviceId: deviceId(),
          deviceName: "",
          tracks: next.queue,
          index: next.index,
          positionSeconds: command.positionSeconds,
          shuffle: command.shuffle,
          repeat: command.repeat,
        },
        command.playing,
        original,
      );
      if (command.radio) {
        restoreRadioSession(command.radio);
        tagSource(
          Object.keys(command.radio.reasons),
          radioSource(Boolean(command.radio.seedTrackId)),
        );
      }
    },
    [takeOver, restoreRadioSession],
  );
  const connected = useConnectPlayback(userId, state, actions, progress, output, load);
  const artwork = useArtworkNavigation(
    connected.state,
    connected.actions,
    connected.progress.getPosition,
  );

  usePlayerPlatform({ ...connected, actions: artwork.actions }, play, setIsPlaying);

  const currentTrackId = connected.state.currentTrack?.id ?? null;
  const currentAlbumId = connected.state.currentTrack?.albumId ?? null;
  const displayedPlaying = connected.state.isPlaying;
  const automaticTrackKey = useMemo(
    () =>
      Object.keys(connected.state.radioSession?.reasons ?? {})
        .filter((id) => !connected.state.radioSession?.manualTrackIds?.includes(id))
        .sort()
        .join(","),
    [connected.state.radioSession],
  );
  const automaticTrackIds = useMemo(
    () => (automaticTrackKey ? automaticTrackKey.split(",") : []),
    [automaticTrackKey],
  );

  const nowPlaying = useMemo<PlayerNowPlaying>(
    () => ({ currentTrackId, currentAlbumId, isPlaying: displayedPlaying, automaticTrackIds }),
    [currentTrackId, currentAlbumId, displayedPlaying, automaticTrackIds],
  );

  return (
    <ConnectContext.Provider value={connected.controls}>
      <PlayerStateContext.Provider value={connected.state}>
        <PlayerActionsContext.Provider value={artwork.actions}>
          <PlayerNowPlayingContext.Provider value={nowPlaying}>
            <PlayerClockContext.Provider value={connected.progress.getPosition}>
              <PlayerProgressContext.Provider value={connected.progress}>
                <ArtworkDirectionContext.Provider value={artwork.direction}>
                  <PlayerQueueContext.Provider value={connected.state.queue}>
                    {children}
                  </PlayerQueueContext.Provider>
                </ArtworkDirectionContext.Provider>
              </PlayerProgressContext.Provider>
            </PlayerClockContext.Provider>
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

export function useArtworkDirection(): ArtworkDirection {
  return React.useContext(ArtworkDirectionContext);
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

export function usePlayerClock(): PlayerProgress["getPosition"] {
  return useRequiredContext(PlayerClockContext, "usePlayerClock", "PlayerProvider");
}

export function useNowPlaying(): PlayerNowPlaying {
  return useRequiredContext(PlayerNowPlayingContext, "useNowPlaying", "PlayerProvider");
}

export function usePlayerQueue(): Track[] {
  return useRequiredContext(PlayerQueueContext, "usePlayerQueue", "PlayerProvider");
}

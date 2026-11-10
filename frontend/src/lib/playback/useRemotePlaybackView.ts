// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { Track } from "@/lib/types";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { positionAt, remoteActions, type ConnectPlayback, type SendCommand } from "./connect";
import type { PlayerActions, PlayerProgress, PlayerState } from "./playerTypes";

export interface RemoteView {
  active: ConnectPlayback;
  tracks: Track[];
  receivedAt: number;
}

const EMPTY_TRACKS: Track[] = [];
const EMPTY_ORDER: number[] = [];

function useRemoteState(remote: RemoteView | null): PlayerState {
  const tracks = remote?.tracks ?? EMPTY_TRACKS;
  const {
    index = -1,
    order = EMPTY_ORDER,
    isPlaying = false,
    buffering = false,
    volume = 1,
    muted = false,
    shuffle = false,
    repeat = "off",
    crossfade = 0,
    smartTransitions = true,
    normalizeVolume = false,
    autoplay = true,
    sleepTimer = null,
    radio = null,
  } = remote?.active ?? {};
  return useMemo(() => {
    const next = order[order.indexOf(index) + 1] ?? (repeat === "all" ? order[0] : -1);
    return {
      queue: tracks,
      queueOrder: order,
      currentIndex: index,
      currentTrack: tracks[index] ?? null,
      nextTrack: tracks[next] ?? null,
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
      sleepTimer,
      radio: "idle",
      radioSession: radio,
    };
  }, [
    tracks,
    order,
    index,
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
    sleepTimer,
    radio,
  ]);
}

export function useRemotePlaybackView({
  selectedId,
  remote,
  available,
  local,
  localActions,
  localProgress,
  send,
  continueHere,
  patchTrack,
}: {
  selectedId: string | null;
  remote: RemoteView | null;
  available: boolean;
  local: PlayerState;
  localActions: PlayerActions;
  localProgress: PlayerProgress;
  send: SendCommand;
  continueHere: () => Promise<boolean>;
  patchTrack: PlayerActions["patchTrack"];
}) {
  const remoteState = useRemoteState(remote);
  const state = selectedId && remote ? remoteState : local;
  const [now, tick] = useState(0);
  const moving = Boolean(
    selectedId && available && remote?.active.isPlaying && !remote.active.buffering,
  );
  useEffect(() => {
    if (!moving) return;
    const timer = window.setInterval(() => tick(performance.now()), 250);
    return () => clearInterval(timer);
  }, [moving]);

  const clock = useRef({ remote, available });
  useLayoutEffect(() => {
    clock.current = { remote, available };
  }, [remote, available]);
  const getPosition = useCallback(() => {
    const { remote, available } = clock.current;
    return remote
      ? positionAt(
          remote.active,
          remote.receivedAt,
          performance.now(),
          remote.tracks[remote.active.index]?.durationSeconds ?? 0,
          available,
        )
      : 0;
  }, []);
  const duration = remoteState.currentTrack?.durationSeconds ?? 0;
  const position = remote
    ? positionAt(
        remote.active,
        remote.receivedAt,
        Math.max(now, remote.receivedAt),
        duration,
        available,
      )
    : 0;
  const remoteProgress = useMemo<PlayerProgress>(
    () => ({
      position,
      duration,
      buffered: 0,
      getPosition,
    }),
    [position, duration, getPosition],
  );
  const revision = remote?.active.queueRevision ?? 0;
  const actions = useMemo(
    () =>
      selectedId
        ? remoteActions(
            state,
            // eslint-disable-next-line react-hooks/refs
            { position: 0, duration, buffered: 0, getPosition },
            revision,
            send,
            continueHere,
            patchTrack,
          )
        : localActions,
    [
      selectedId,
      state,
      duration,
      getPosition,
      revision,
      send,
      continueHere,
      patchTrack,
      localActions,
    ],
  );
  return { state, actions, progress: selectedId ? remoteProgress : localProgress };
}

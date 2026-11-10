// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { Track } from "@/lib/types";
import { useCallback, useMemo, useRef, useState } from "react";
import { advanceIn } from "./playerQueue";
import type { RepeatMode } from "./playerTypes";
import { queueEntries } from "./queueEntries";
import type { PersistedPlayer } from "./usePlayerStorage";

export function useQueueState() {
  const [queue, setQueue] = useState<Track[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const queueRef = useRef<Track[]>([]);
  const orderRef = useRef<number[]>([]);

  const applyQueue = useCallback((tracks: Track[], nextOrder: number[]) => {
    const entries = queueEntries(tracks, queueRef.current);
    queueRef.current = entries;
    orderRef.current = nextOrder;
    setQueue(entries);
    setOrder(nextOrder);
  }, []);

  const currentTrack = currentIndex >= 0 ? (queue[currentIndex] ?? null) : null;
  const restoreSession = useCallback(
    (saved: PersistedPlayer) => {
      applyQueue(
        saved.queue,
        saved.queue.map((_, index) => index),
      );
      if (saved.index >= 0) setCurrentIndex(saved.index);
      setShuffle(saved.shuffle);
      setRepeat(saved.repeat);
    },
    [applyQueue],
  );
  const nextTrack = useMemo(() => {
    const step = advanceIn(order, currentIndex, 1, repeat === "all");
    return step.kind === "play" ? (queue[step.index] ?? null) : null;
  }, [order, queue, currentIndex, repeat]);

  return {
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
    applyQueue,
    currentTrack,
    nextTrack,
    restoreSession,
  };
}

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import { recordEvent } from "@/lib/events";
import { tagSource } from "@/lib/playback/playSource";
import {
  appendTrack,
  buildOrder,
  indexAfterRemoval,
  insertAfter,
  moveInQueue as reorderQueue,
  remapIndexAfterMove,
} from "@/lib/playback/playerQueue";
import type { Track } from "@/lib/types";

interface QueueEditingInput {
  queueRef: RefObject<Track[]>;
  orderRef: RefObject<number[]>;
  live: RefObject<{ currentIndex: number; shuffle: boolean }>;
  applyQueue: (queue: Track[], order: number[]) => void;
  setCurrentIndex: Dispatch<SetStateAction<number>>;
  noteRadioInsert: (at: number, previousLength: number) => void;
  pinRadioTrack: (trackId: string) => void;
}

export function useQueueEditing({
  queueRef,
  orderRef,
  live,
  applyQueue,
  setCurrentIndex,
  noteRadioInsert,
  pinRadioTrack,
}: QueueEditingInput) {
  const addToQueue = useCallback(
    (track: Track) => {
      recordEvent({ type: "trackAddedToQueue", trackId: track.id });
      tagSource([track.id], "queue");
      pinRadioTrack(track.id);

      const next = appendTrack(queueRef.current, orderRef.current, track);
      applyQueue(next.queue, next.order);

      setCurrentIndex((index) => (index < 0 ? 0 : index));
    },
    [applyQueue, orderRef, queueRef, setCurrentIndex, pinRadioTrack],
  );

  const playNext = useCallback(
    (track: Track) => {
      const current = queueRef.current;
      const { currentIndex } = live.current;
      if (current.length === 0 || currentIndex < 0) {
        addToQueue(track);
        return;
      }

      recordEvent({ type: "trackAddedToQueue", trackId: track.id });
      tagSource([track.id], "queue");
      pinRadioTrack(track.id);

      const next = insertAfter(current, orderRef.current, currentIndex, track);

      noteRadioInsert(currentIndex + 1, current.length);

      applyQueue(next.queue, next.order);
    },
    [addToQueue, applyQueue, live, noteRadioInsert, orderRef, queueRef, pinRadioTrack],
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      const current = queueRef.current;
      if (index < 0 || index >= current.length) return;

      const remaining = current.filter((_, position) => position !== index);
      applyQueue(remaining, buildOrder(remaining.length, live.current.shuffle, -1));

      setCurrentIndex((activeIndex) => indexAfterRemoval(index, activeIndex, remaining.length));
    },
    [applyQueue, live, queueRef, setCurrentIndex],
  );

  const moveInQueue = useCallback(
    (from: number, to: number) => {
      const current = queueRef.current;
      const next = reorderQueue(current, orderRef.current, from, to, live.current.shuffle);
      if (next.queue === current) return;
      tagSource([current[from].id], "queue");
      pinRadioTrack(current[from].id);

      applyQueue(next.queue, next.order);
      setCurrentIndex((index) => (index < 0 ? index : remapIndexAfterMove(from, to, index)));
    },
    [applyQueue, live, orderRef, queueRef, setCurrentIndex, pinRadioTrack],
  );

  const patchTrack = useCallback(
    (trackId: string, changes: Partial<Track>) => {
      applyQueue(
        queueRef.current.map((track) => (track.id === trackId ? { ...track, ...changes } : track)),
        orderRef.current,
      );
    },
    [applyQueue, orderRef, queueRef],
  );

  return { addToQueue, playNext, removeFromQueue, moveInQueue, patchTrack };
}

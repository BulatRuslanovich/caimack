// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { Track } from "@/lib/types";
import { queueEntryKey } from "./queueEntries";

interface QueueShape {
  queue: Track[];
  order: number[];
}

interface QueuePlayback extends QueueShape {
  index: number;
}

/** Store the actual playback sequence in the visible queue, with no hidden shuffle order. */
export function materializeQueue(queue: Track[], order: number[], index: number): QueuePlayback {
  const valid =
    order.length === queue.length &&
    new Set(order).size === queue.length &&
    order.every((value) => Number.isInteger(value) && value >= 0 && value < queue.length);
  const sequence = valid ? order : queue.map((_, position) => position);
  return {
    queue: sequence.map((position) => queue[position]),
    order: queue.map((_, position) => position),
    index: sequence.indexOf(index),
  };
}

export function startPlaybackQueue(
  queue: Track[],
  startIndex: number,
  shuffled: boolean,
  random: () => number = Math.random,
): QueuePlayback {
  if (!queue.length) return { queue, order: [], index: -1 };
  const index = Math.max(0, Math.min(startIndex, queue.length - 1));
  const order = shuffled
    ? buildOrder(queue.length, true, index, random)
    : [...queue.keys()].slice(index).concat([...queue.keys()].slice(0, index));
  return materializeQueue(queue, order, index);
}

export function restorePlaybackOrder(
  queue: Track[],
  index: number,
  original: Track[],
): QueuePlayback {
  const ranks = new Map(original.map((track, position) => [queueEntryKey(track), position]));
  const start = queue[index] ? (ranks.get(queueEntryKey(queue[index])) ?? -1) : -1;
  const rank = (position: number) => {
    const value = ranks.get(queueEntryKey(queue[position]));
    return value === undefined || original.length === 0
      ? original.length + position
      : (value - start - 1 + original.length) % original.length;
  };
  const order = [...queue.keys()];
  const tail = order.slice(index + 1).sort((a, b) => rank(a) - rank(b));
  return materializeQueue(queue, order.slice(0, index + 1).concat(tail), index);
}

export function selectQueueEntry(queue: Track[], current: number, selected: number): QueuePlayback {
  const order = [...queue.keys()];
  if (selected < 0 || selected >= queue.length) return { queue, order, index: current };
  const index =
    selected === current ? current : current < 0 ? 0 : selected > current ? current + 1 : current;
  order.splice(index, 0, ...order.splice(selected, 1));
  return materializeQueue(queue, order, selected);
}

type Advance =
  { kind: "none" } | { kind: "restart" } | { kind: "stop" } | { kind: "play"; index: number };

export function buildOrder(
  length: number,
  shuffled: boolean,
  startIndex: number,
  random: () => number = Math.random,
): number[] {
  const indices = Array.from({ length }, (_, index) => index);
  if (!shuffled) return indices;

  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  if (startIndex >= 0) {
    const at = indices.indexOf(startIndex);
    if (at > 0) [indices[0], indices[at]] = [indices[at], indices[0]];
  }

  return indices;
}

export function appendTrack(queue: Track[], order: number[], track: Track): QueueShape {
  const next = [...queue, track];
  return { queue: next, order: [...order, next.length - 1] };
}

export function appendTracks(queue: Track[], order: number[], tracks: Track[]): QueueShape {
  return {
    queue: [...queue, ...tracks],
    order: [...order, ...tracks.map((_, offset) => queue.length + offset)],
  };
}

export function insertAfter(
  queue: Track[],
  order: number[],
  currentIndex: number,
  track: Track,
): QueueShape {
  const at = currentIndex + 1;
  const next = [...queue.slice(0, at), track, ...queue.slice(at)];
  const shifted = order.map((index) => (index >= at ? index + 1 : index));

  shifted.splice(shifted.indexOf(currentIndex) + 1, 0, at);

  return { queue: next, order: shifted };
}

export function radioStartAfterInsert(
  radioFrom: number,
  insertedAt: number,
  queueLength: number,
): number {
  return radioFrom < queueLength && insertedAt <= radioFrom ? radioFrom + 1 : radioFrom;
}

export function remapIndexAfterMove(from: number, to: number, index: number): number {
  if (index === from) return to;
  if (from < to) return index > from && index <= to ? index - 1 : index;
  return index >= to && index < from ? index + 1 : index;
}

export function moveInQueue(queue: Track[], order: number[], from: number, to: number): QueueShape {
  const last = queue.length - 1;
  if (from === to || from < 0 || to < 0 || from > last || to > last) return { queue, order };

  const moved = [...queue];
  const [track] = moved.splice(from, 1);
  moved.splice(to, 0, track);

  return {
    queue: moved,
    order: moved.map((_, index) => index),
  };
}

export function indexAfterRemoval(
  removedIndex: number,
  activeIndex: number,
  remainingLength: number,
): number {
  if (remainingLength === 0) return -1;
  if (removedIndex < activeIndex) return activeIndex - 1;
  if (removedIndex === activeIndex) return Math.min(activeIndex, remainingLength - 1);
  return activeIndex;
}

export function advanceIn(
  order: number[],
  currentIndex: number,
  direction: 1 | -1,
  repeatAll: boolean,
): Advance {
  if (order.length === 0 || currentIndex < 0) return { kind: "none" };

  const positionInOrder = order.indexOf(currentIndex);
  if (positionInOrder === -1) return { kind: "none" };

  const nextPosition = positionInOrder + direction;

  if (nextPosition < 0) return { kind: "restart" };

  if (nextPosition >= order.length) {
    return repeatAll ? { kind: "play", index: order[0] } : { kind: "stop" };
  }

  return { kind: "play", index: order[nextPosition] };
}

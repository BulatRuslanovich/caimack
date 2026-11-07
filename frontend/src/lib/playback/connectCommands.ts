// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { api } from "@/lib/api";
import { tagSource } from "./playSource";
import type { ConnectCommand } from "./connect";
import type { PlayerActions, PlayerState } from "./playerTypes";
import type { Track } from "@/lib/types";

export async function lookupQueue(ids: string[], signal?: AbortSignal): Promise<Track[]> {
  const known = new Map<string, Track>();
  for (let offset = 0; offset < ids.length; offset += 200) {
    for (const track of await api.lookupTracks(ids.slice(offset, offset + 200), signal))
      known.set(track.id, track);
  }
  return ids.map((id) => {
    const track = known.get(id);
    if (!track) throw new Error("A track is no longer available.");
    return track;
  });
}

export async function applyConnectCommand(
  command: ConnectCommand,
  state: PlayerState,
  actions: PlayerActions,
  load: (tracks: Track[], command: Extract<ConnectCommand, { type: "play" }>) => void,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const check = (index: number, id: string) => {
    if (state.queue[index]?.id !== id) throw new Error("The playback queue changed.");
  };
  switch (command.type) {
    case "setPlaying":
      if (state.isPlaying !== command.playing) actions.toggle();
      break;
    case "next":
      actions.next();
      break;
    case "previous":
      actions.previous();
      break;
    case "seek":
      actions.seek(command.positionSeconds);
      break;
    case "setVolume":
      actions.setVolume(command.volume);
      break;
    case "setMuted":
      if (state.muted !== command.muted) actions.toggleMute();
      break;
    case "setShuffle":
      actions.setShuffle(command.shuffle);
      break;
    case "setRepeat": {
      const modes = ["off", "all", "one"];
      const steps = (modes.indexOf(command.repeat) - modes.indexOf(state.repeat) + 3) % 3;
      for (let i = 0; i < steps; i++) actions.cycleRepeat();
      break;
    }
    case "play": {
      const tracks = await lookupQueue(command.trackIds, signal);
      signal?.throwIfAborted();
      tagSource(command.trackIds, command.source ?? "queue");
      load(tracks, command);
      break;
    }
    case "enqueue": {
      const [track] = await lookupQueue([command.trackId], signal);
      signal?.throwIfAborted();
      if (command.next) actions.playNext(track);
      else actions.addToQueue(track);
      break;
    }
    case "remove":
      check(command.index, command.trackId);
      actions.removeFromQueue(command.index);
      break;
    case "jump":
      check(command.index, command.trackId);
      actions.jumpTo(command.index);
      break;
    case "move":
      check(command.from, command.trackId);
      if (!state.queue[command.to]) throw new Error("The playback queue changed.");
      actions.moveInQueue(command.from, command.to);
      break;
    case "clear":
      actions.clearQueue();
      break;
    case "clearUpcoming": {
      const snapshot = actions.snapshotQueue();
      const keep = new Set(
        state.queueOrder.slice(0, state.queueOrder.indexOf(state.currentIndex) + 1),
      );
      const positions = state.queue.map((_, index) => index).filter((index) => keep.has(index));
      const remap = new Map(positions.map((index, next) => [index, next]));
      actions.restoreQueue({
        ...snapshot,
        queue: positions.map((index) => state.queue[index]),
        order: state.queueOrder
          .filter((index) => keep.has(index))
          .map((index) => remap.get(index)!),
        index: remap.get(state.currentIndex) ?? -1,
      });
      break;
    }
    case "startRadio": {
      const seed = command.seedTrackId
        ? (await lookupQueue([command.seedTrackId], signal))[0]
        : null;
      signal?.throwIfAborted();
      if (!(await actions.startRadio(seed, signal))) throw new Error("Could not start the radio.");
      break;
    }
    case "setRadioFocus":
      actions.setRadioFocus(command.focus);
      break;
    case "setCrossfade":
      actions.setCrossfade(command.seconds);
      break;
    case "setSmartTransitions":
      actions.setSmartTransitions(command.enabled);
      break;
    case "setNormalizeVolume":
      actions.setNormalizeVolume(command.enabled);
      break;
    case "setAutoplay":
      actions.setAutoplay(command.enabled);
      break;
    case "setSleepTimer":
      actions.setSleepTimer(command.trackEnd ? "trackEnd" : command.minutes);
      break;
  }
}

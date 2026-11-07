// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it, vi } from "vitest";
import { positionAt, remoteActions, remoteState } from "./connect";
import type { ConnectPlayback } from "./connect";
import type { Track } from "@/lib/types";

const tracks = ["first", "second", "third"].map(
  (id) => ({ id, title: id, durationSeconds: 120 }) as Track,
);
const active: ConnectPlayback = {
  deviceId: "computer",
  queueRevision: 12,
  reportedAt: new Date(0).toISOString(),
  trackIds: tracks.map((track) => track.id),
  index: 0,
  order: [0, 2, 1],
  positionSeconds: 15,
  isPlaying: true,
  buffering: false,
  volume: 0.6,
  muted: false,
  shuffle: true,
  repeat: "off",
  radio: null,
  crossfade: 0,
  smartTransitions: true,
  normalizeVolume: false,
  autoplay: true,
  sleepTimer: null,
};

describe("the existing player controlling a remote renderer", () => {
  it("uses the renderer's shuffle order and modes, including the next track", () => {
    const state = remoteState(active, tracks);
    expect(state.nextTrack?.id).toBe("third");
    expect(state.volume).toBe(0.6);
    expect(state.shuffle).toBe(true);
  });

  it("advances progress only while online, playing and not buffering, and clamps it to duration", () => {
    expect(positionAt(active, 1000, 4000, 120, true)).toBe(18);
    expect(positionAt(active, 1000, 4000, 120, false)).toBe(15);
    expect(positionAt({ ...active, buffering: true }, 1000, 4000, 120, true)).toBe(15);
    expect(positionAt(active, 1000, 400000, 120, true)).toBe(120);
  });

  it("routes transport, seek and volume to the renderer through the same player actions", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const state = remoteState(active, tracks);
    const actions = remoteActions(
      state,
      { position: 15, duration: 120, buffered: 0, getPosition: () => 18 },
      12,
      send,
      vi.fn(),
      vi.fn(),
    );
    actions.toggle();
    actions.next();
    actions.previous();
    actions.seekBy(10);
    actions.setVolume(0.3);
    expect(send.mock.calls.map((call) => call[0])).toEqual([
      { type: "setPlaying", playing: false },
      { type: "next" },
      { type: "previous" },
      { type: "seek", positionSeconds: 28 },
      { type: "setVolume", volume: 0.3 },
    ]);
  });

  it("fences edits with queue revision and track identity, even for duplicate titles", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const actions = remoteActions(
      remoteState(active, tracks),
      { position: 15, duration: 120, buffered: 0, getPosition: () => 15 },
      12,
      send,
      vi.fn(),
      vi.fn(),
    );
    actions.removeFromQueue(1);
    actions.moveInQueue(2, 1);
    actions.jumpTo(2);
    expect(send.mock.calls).toEqual([
      [{ type: "remove", index: 1, trackId: "second" }, 12],
      [{ type: "move", from: 2, to: 1, trackId: "third" }, 12],
      [{ type: "jump", index: 2, trackId: "third" }, 12],
    ]);
  });

  it("starts a library track on the selected device and preserves its context queue", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const actions = remoteActions(
      remoteState(active, tracks),
      { position: 15, duration: 120, buffered: 0, getPosition: () => 15 },
      12,
      send,
      vi.fn(),
      vi.fn(),
    );
    actions.playTrack(tracks[2], tracks);
    expect(send.mock.calls[0][0]).toMatchObject({
      type: "play",
      trackIds: ["first", "second", "third"],
      index: 2,
      playing: true,
    });
  });

  it("keeps radio and actual playback order when restoring a remote queue", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const radio = { seedTrackId: "first", reasons: {} };
    const actions = remoteActions(
      remoteState({ ...active, radio }, tracks),
      { position: 15, duration: 120, buffered: 0, getPosition: () => 15 },
      12,
      send,
      vi.fn(),
      vi.fn(),
    );
    actions.restoreQueue(actions.snapshotQueue());
    expect(send.mock.calls[0][0]).toMatchObject({ type: "play", order: [0, 2, 1], radio });
  });
});

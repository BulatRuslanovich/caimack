// SPDX-License-Identifier: AGPL-3.0-only

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/lib/types";
import { usePlayback } from "./usePlayback";

const player = vi.hoisted(() => ({
  queue: [] as Track[],
  currentTrack: null as Track | null,
  isPlaying: true,
  toggle: vi.fn(),
  playQueue: vi.fn(),
  playTrack: vi.fn(),
}));

vi.mock("@/contexts/PlayerContext", () => ({
  useNowPlaying: () => ({
    currentTrackId: player.currentTrack?.id ?? null,
    isPlaying: player.isPlaying,
  }),
  usePlayerQueue: () => player.queue,
  usePlayerActions: () => player,
}));

const tracks = (...ids: string[]) => ids.map((id) => ({ id }) as Track);

function playback() {
  let value!: ReturnType<typeof usePlayback>;
  function Probe() {
    value = usePlayback();
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return value;
}

describe("playing a collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    player.queue = tracks("a", "shared");
    player.currentTrack = player.queue[1];
  });

  it("replaces another collection even when it contains the current track", () => {
    const next = tracks("b", "shared");
    const view = playback();
    expect(view.setIsOnAir(next)).toBe(false);
    view.playSet(next, 1);
    expect(player.playQueue).toHaveBeenCalledWith(next, 1);
    expect(player.toggle).not.toHaveBeenCalled();
  });

  it("toggles the same ordered queue even after advancing beyond its first track", () => {
    const same = tracks("a", "shared");
    const view = playback();
    expect(view.setIsOnAir(same)).toBe(true);
    view.playSet(same);
    expect(player.toggle).toHaveBeenCalledOnce();
    expect(player.playQueue).not.toHaveBeenCalled();
  });

  it.each([
    ["shared", "a"],
    ["a", "shared", "shared"],
  ])("replaces a queue with different order or repeated entries: %j", (...ids) => {
    const next = tracks(...ids);
    playback().playSet(next);
    expect(player.playQueue).toHaveBeenCalledWith(next, 0);
    expect(player.toggle).not.toHaveBeenCalled();
  });

  it("does nothing for an empty collection", () => {
    playback().playSet([]);
    expect(player.playQueue).not.toHaveBeenCalled();
    expect(player.toggle).not.toHaveBeenCalled();
  });

  it("starts playback when there is no current track", () => {
    player.currentTrack = null;
    playback().playSet(player.queue);
    expect(player.playQueue).toHaveBeenCalledWith(player.queue, 0);
  });
});

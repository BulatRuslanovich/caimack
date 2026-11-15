// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/lib/types";
import { PlayerPanelTransport } from "./PlayerPanelTransport";

const player = vi.hoisted(() => ({
  currentTrack: null as Track | null,
  isPlaying: false,
  buffering: false,
  toggle: vi.fn(),
  next: vi.fn(),
}));
const buttons = vi.hoisted(() => new Map<string, ComponentProps<"button">>());

vi.mock("@/contexts/PlayerContext", () => ({
  usePlayerState: () => player,
  usePlayerActions: () => player,
}));
vi.mock("@/contexts/I18nContext", () => ({
  useT: () => (key: string, values?: { title?: string }) =>
    values?.title ? `${key}: ${values.title}` : key,
}));
vi.mock("./Cover", () => ({ TrackCover: () => <span /> }));
vi.mock("./ui/button", () => ({
  Button: (props: ComponentProps<"button">) => {
    buttons.set(props["aria-label"]!, props);
    return (
      <button aria-label={props["aria-label"]} aria-busy={props["aria-busy"]}>
        {props.children}
      </button>
    );
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  buttons.clear();
  player.currentTrack = {
    id: "current",
    title: "A long track title",
    artistName: "Artist",
  } as Track;
  player.isPlaying = false;
  player.buffering = false;
});

describe("transport outside the mobile queue and lyrics pane", () => {
  it.each([false, true])(
    "keeps the current track, toggle and next action available while playing=%s",
    (playing) => {
      player.isPlaying = playing;
      const markup = renderToStaticMarkup(<PlayerPanelTransport onShowArtwork={vi.fn()} />);
      expect(markup).toContain("A long track title");
      expect(markup).toContain("Artist");
      const toggle = buttons.get(playing ? "action.pause" : "action.play");
      expect(toggle).toBeDefined();
      toggle!.onClick!({} as never);
      buttons.get("player.nextTrack")!.onClick!({} as never);
      expect(player.toggle).toHaveBeenCalledOnce();
      expect(player.next).toHaveBeenCalledOnce();
    },
  );

  it("keeps playback available while buffering and reports the busy state", () => {
    player.buffering = true;
    renderToStaticMarkup(<PlayerPanelTransport onShowArtwork={vi.fn()} />);
    const toggle = buttons.get("action.play")!;
    expect(toggle["aria-busy"]).toBe(true);
    expect(toggle.disabled).not.toBe(true);
  });

  it("does not leave stale controls behind after the queue is cleared", () => {
    player.currentTrack = null;
    expect(renderToStaticMarkup(<PlayerPanelTransport onShowArtwork={vi.fn()} />)).toBe("");
    expect(buttons.size).toBe(0);
  });
});

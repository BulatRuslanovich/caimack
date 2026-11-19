// SPDX-License-Identifier: AGPL-3.0-only

import type { SyntheticEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { PlaybackRecovery } from "./playbackRecovery";
import { createListeningTracker } from "./playbackTelemetry";
import { useAudioEvents } from "./useAudioEvents";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
}));

function setup() {
  const audio = {
    paused: false,
    ended: false,
    dataset: { trackId: "current" } as Record<string, string>,
    error: null as MediaError | null,
  } as HTMLAudioElement;
  const audioRef = { current: audio };
  const scrubRef = { current: null as number | null };
  const setIsPlaying = vi.fn();
  const clearWaitingTimer = vi.fn();
  const handleEnded = vi.fn();
  // useCallback is mocked; exercise the event handlers without a React mount.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const props = useAudioEvents({
    audioRef,
    currentTrackId: "current",
    isPlaying: true,
    scrubRef,
    tracker: createListeningTracker(),
    recovery: new PlaybackRecovery(),
    handleTimeUpdate: vi.fn(),
    handleProgress: vi.fn(),
    setDuration: vi.fn(),
    setWaiting: vi.fn(),
    handleEnded,
    handleError: vi.fn(),
    handleWaiting: vi.fn(),
    setIsPlaying,
    clearWaitingTimer,
  });
  const event = { currentTarget: audio } as SyntheticEvent<HTMLAudioElement>;
  return { audio, audioRef, scrubRef, props, event, setIsPlaying, clearWaitingTimer, handleEnded };
}

describe("audio playback events", () => {
  it("ignores a queued pause after playback has already resumed", () => {
    const { props, event, setIsPlaying, clearWaitingTimer } = setup();
    props.onPause!(event);
    expect(setIsPlaying).not.toHaveBeenCalled();
    expect(clearWaitingTimer).not.toHaveBeenCalled();
  });

  it("ignores a queued play after playback has already paused", () => {
    const { audio, props, event, setIsPlaying } = setup();
    Object.assign(audio, { paused: true });
    props.onPlay!(event);
    expect(setIsPlaying).not.toHaveBeenCalled();
  });

  it("settles after pause and play are queued together instead of feeding back forever", () => {
    const { audio, props, event, setIsPlaying } = setup();
    const events: ("pause" | "play")[] = [];
    let playing = true;
    const change = (next: boolean) => {
      if (audio.paused === !next) return;
      Object.assign(audio, { paused: !next });
      events.push(next ? "play" : "pause");
    };
    // Model the engine effect: a change to React's isPlaying drives the element.
    setIsPlaying.mockImplementation((next: boolean) => {
      if (playing === next) return;
      playing = next;
      change(next);
    });

    change(false);
    change(true);
    for (let turn = 0; events.length && turn < 20; turn++) {
      if (events.shift() === "pause") props.onPause!(event);
      else props.onPlay!(event);
    }

    expect(events).toEqual([]);
    expect(playing).toBe(true);
    expect(audio.paused).toBe(false);
  });

  it("reflects a current pause and a subsequent play", () => {
    const { audio, props, event, setIsPlaying, clearWaitingTimer } = setup();
    Object.assign(audio, { paused: true });
    props.onPause!(event);
    expect(setIsPlaying).toHaveBeenLastCalledWith(false);
    expect(clearWaitingTimer).toHaveBeenCalledOnce();

    Object.assign(audio, { paused: false });
    props.onPlay!(event);
    expect(setIsPlaying).toHaveBeenLastCalledWith(true);
  });

  it.each(["loading", "scrubbing", "error", "inactive", "previous track", "ended"])(
    "does not treat the pause as a playback intent change (%s)",
    (reason) => {
      const { audio, audioRef, scrubRef, props, event, setIsPlaying } = setup();
      Object.assign(audio, { paused: true });
      if (reason === "loading") audio.dataset.sourceLoading = "true";
      if (reason === "scrubbing") scrubRef.current = 12;
      if (reason === "error") Object.assign(audio, { error: { code: 2 } });
      if (reason === "inactive") audioRef.current = {} as HTMLAudioElement;
      if (reason === "previous track") audio.dataset.trackId = "previous";
      if (reason === "ended") Object.assign(audio, { ended: true });
      props.onPause!(event);
      expect(setIsPlaying).not.toHaveBeenCalled();
    },
  );

  it("advances only for the end of the selected source", () => {
    const { audio, props, event, handleEnded } = setup();
    props.onEnded!(event);
    Object.assign(audio, { paused: true, ended: true });
    audio.dataset.trackId = "previous";
    props.onEnded!(event);
    expect(handleEnded).not.toHaveBeenCalled();

    audio.dataset.trackId = "current";
    props.onEnded!(event);
    expect(handleEnded).toHaveBeenCalledOnce();
  });
});

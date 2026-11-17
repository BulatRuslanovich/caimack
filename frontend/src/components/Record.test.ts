// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentProps, PointerEvent, ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Record } from "./Record";

const mocks = vi.hoisted(() => ({
  selectedId: null as string | null,
  muted: false,
  volume: 0.6,
  scrubBy: vi.fn(),
  holdScrub: vi.fn(),
  commitScrub: vi.fn(),
  start: vi.fn(),
  move: vi.fn(),
  end: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useRef: (value: unknown) => ({ current: value }),
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
}));
vi.mock("@/contexts/PlayerContext", () => ({
  usePlayerActions: () => ({
    scrubBy: mocks.scrubBy,
    holdScrub: mocks.holdScrub,
    commitScrub: mocks.commitScrub,
    getDuration: () => 120,
  }),
  usePlayerClock: () => () => 30,
  usePlayerState: () => ({ volume: mocks.volume, muted: mocks.muted }),
}));
vi.mock("@/lib/playback/equalizer", () => ({
  startVinylScratch: mocks.start,
  moveVinylScratch: mocks.move,
  endVinylScratch: mocks.end,
}));
vi.mock("@/lib/playback/vinylDeck", () => ({
  VINYL_TURN_SECONDS: 1.8,
}));
vi.mock("@/lib/playback/useConnectPlayback", () => ({
  useConnect: () => ({ selectedId: mocks.selectedId }),
}));
vi.mock("@/lib/visualizer", () => ({ useVisualizer: () => false }));
vi.mock("./Cover", () => ({ TrackCover: () => null }));
vi.mock("./RecordAura", () => ({ RecordAura: () => null }));

function record(scratchable = true) {
  const element = Record({
    track: { id: "track", title: "Track", hasCover: false },
    out: true,
    spinning: true,
    scratchable,
  });
  return (element.props.children[0] as ReactElement<ComponentProps<"div">>).props;
}

function pointer(x: number, y: number, timeStamp: number) {
  return {
    clientX: x,
    clientY: y,
    timeStamp,
    button: 0,
    pointerId: 1,
    preventDefault: vi.fn(),
    currentTarget: {
      setPointerCapture: vi.fn(),
      hasPointerCapture: () => false,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    },
  } as unknown as PointerEvent<HTMLDivElement>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectedId = null;
  mocks.muted = false;
  mocks.volume = 0.6;
  mocks.start.mockReturnValue(true);
});

describe("record scratching", () => {
  it("plays the track in both directions at hand speed by default", () => {
    const disc = record();
    disc.onPointerDown!(pointer(200, 100, 100));
    expect(mocks.start).toHaveBeenCalledWith("track", 30);
    expect(mocks.holdScrub).toHaveBeenCalledOnce();

    disc.onPointerMove!(pointer(100, 200, 120));
    expect(mocks.move).toHaveBeenLastCalledWith(30.45, 0.02);
    expect(mocks.scrubBy.mock.lastCall![0]).toBeCloseTo(0.45, 10);

    disc.onPointerMove!(pointer(200, 100, 130));
    expect(mocks.move).toHaveBeenLastCalledWith(30, 0.01);
    expect(mocks.scrubBy.mock.lastCall![0]).toBeCloseTo(-0.45, 10);

    disc.onPointerUp!(pointer(200, 100, 140));
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(mocks.commitScrub).toHaveBeenCalledOnce();
    disc.onPointerMove!(pointer(100, 200, 150));
    expect(mocks.move).toHaveBeenCalledTimes(2);
  });

  it("plays at 1x at the visible platter speed", () => {
    const disc = record();
    disc.onPointerDown!(pointer(200, 100, 100));
    // A quarter turn in 450 ms matches the 1.8-second animation revolution.
    disc.onPointerMove!(pointer(100, 200, 550));
    expect(mocks.move).toHaveBeenLastCalledWith(30.45, 0.45);
    disc.onPointerMove!(pointer(0, 100, 1000));
    const [position, seconds] = mocks.move.mock.lastCall!;
    expect((position - 30.45) / seconds).toBeCloseTo(1, 10);
  });

  it.each(["muted", "zero volume", "remote"])("does not emit scratch audio when %s", (mode) => {
    mocks.muted = mode === "muted";
    mocks.volume = mode === "zero volume" ? 0 : 0.6;
    mocks.selectedId = mode === "remote" ? "remote-device" : null;
    const disc = record();
    disc.onPointerDown!(pointer(200, 100, 100));
    disc.onPointerMove!(pointer(100, 200, 120));
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.move).not.toHaveBeenCalled();
    expect(mocks.scrubBy.mock.lastCall![0]).toBeCloseTo(0.45, 10);
  });

  it("ignores pointer movement on decorative records", () => {
    const disc = record(false);
    disc.onPointerDown!(pointer(200, 100, 100));
    disc.onPointerMove!(pointer(100, 200, 120));
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.holdScrub).not.toHaveBeenCalled();
    expect(mocks.scrubBy).not.toHaveBeenCalled();
  });
});

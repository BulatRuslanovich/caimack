// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Exercise the store without mounting a component; audio and storage remain real code.
vi.mock("react", () => ({
  useSyncExternalStore: (_: unknown, snapshot: () => unknown) => snapshot(),
}));

const parameter = () => ({ value: 0, setTargetAtTime: vi.fn() });
const node = () => ({ connect: vi.fn().mockReturnThis() });
const filterNode = () => ({
  ...node(),
  type: "",
  frequency: parameter(),
  Q: parameter(),
  gain: parameter(),
});
class AudioGraph {
  currentTime = 0;
  destination = node();
  resume = vi.fn().mockResolvedValue(undefined);
  filters: ReturnType<typeof filterNode>[] = [];
  sources: HTMLMediaElement[] = [];
  gain = { ...node(), gain: parameter() };
  createGain() {
    return this.gain;
  }
  createBiquadFilter() {
    const filter = filterNode();
    this.filters.push(filter);
    return filter;
  }
  createMediaElementSource(element: HTMLMediaElement) {
    this.sources.push(element);
    return node();
  }
}
let graph: AudioGraph;

beforeEach(() => {
  vi.resetModules();
  const saved = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("navigator", { userAgent: "test", platform: "Linux", maxTouchPoints: 0 });
  vi.stubGlobal(
    "AudioContext",
    vi.fn(function () {
      graph = new AudioGraph();
      return graph;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

it("connects every band, applies preamp settings and bypasses processing at unity gain", async () => {
  const { connectEqualizer, useEqualizer, EQ_BANDS } = await import("./equalizer");
  connectEqualizer([{} as HTMLMediaElement]);
  const eq = useEqualizer();
  eq.setEnabled(true);
  expect(graph.filters.map((filter) => filter.frequency.value)).toEqual(EQ_BANDS);
  eq.applyPreset("bass");
  expect(graph.filters[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(6, 0, 0.02);
  expect(graph.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(10 ** (-6 / 20), 0, 0.02);
  eq.setAutoHeadroom(false);
  eq.setPreamp(3);
  expect(graph.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(10 ** (3 / 20), 0, 0.02);
  eq.setEnabled(false);
  for (const filter of graph.filters)
    expect(filter.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.02);
  expect(graph.gain.gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, 0.02);
});

it("attaches replacement player elements exactly once after a session remount", async () => {
  const { connectEqualizer, useEqualizer } = await import("./equalizer");
  const original = {} as HTMLMediaElement;
  const replacement = {} as HTMLMediaElement;
  connectEqualizer([original]);
  useEqualizer().setEnabled(true);
  connectEqualizer([replacement]);
  connectEqualizer([replacement]);
  expect(graph.sources).toEqual([original, replacement]);
});

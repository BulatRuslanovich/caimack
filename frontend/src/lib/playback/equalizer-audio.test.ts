// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Exercise the store without mounting a component; audio and storage remain real code.
vi.mock("react", () => ({
  useSyncExternalStore: (_: unknown, snapshot: () => unknown) => snapshot(),
}));

const parameter = () => ({ value: 0, setTargetAtTime: vi.fn() });
const node = () => ({ connect: vi.fn().mockReturnThis(), disconnect: vi.fn() });
const filterNode = () => ({
  ...node(),
  type: "",
  frequency: parameter(),
  Q: parameter(),
  gain: parameter(),
});
class AudioGraph {
  currentTime = 0;
  sampleRate = 48_000;
  destination = node();
  resume = vi.fn().mockResolvedValue(undefined);
  filters: ReturnType<typeof filterNode>[] = [];
  sources: HTMLMediaElement[] = [];
  gain = { ...node(), gain: parameter() };
  input = { ...node(), gain: parameter() };
  gainsCreated = 0;
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
  createGain() {
    return this.gainsCreated++ === 0 ? this.gain : this.input;
  }
  createAnalyser() {
    return { ...node(), fftSize: 0, minDecibels: 0, maxDecibels: 0, smoothingTimeConstant: 0 };
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
    isSecureContext: true,
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

it("uses a separate fast analyser with headroom for fullscreen drum attacks", async () => {
  const { connectEqualizer, useEqualizer, audioAnalyser } = await import("./equalizer");
  connectEqualizer([{} as HTMLMediaElement]);
  useEqualizer().setEnabled(true);
  const ambient = audioAnalyser()!;
  const fast = audioAnalyser("transients")!;
  expect(fast).not.toBe(ambient);
  expect(fast.fftSize).toBe(2048);
  expect(fast.smoothingTimeConstant).toBe(0.12);
  expect(fast.maxDecibels).toBeGreaterThan(ambient.maxDecibels);
  expect(ambient.smoothingTimeConstant).toBe(0.7);
  expect(audioAnalyser("transients")).toBe(fast);
  expect(graph.sources).toHaveLength(1);
  expect(graph.gain.connect).toHaveBeenCalledWith(fast);
});

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

it("adds scratch processing without reconnecting media sources and restores dry audio on processor failure", async () => {
  const worklet = {
    ...node(),
    port: { postMessage: vi.fn() },
    onprocessorerror: null as (() => void) | null,
  };
  const constructor = vi.fn(function () {
    return worklet;
  });
  vi.stubGlobal("AudioWorkletNode", constructor);
  const audio = {
    dataset: { trackId: "track" },
    volume: 0.6,
    muted: false,
  } as unknown as HTMLMediaElement;
  const eq = await import("./equalizer");
  eq.connectEqualizer([audio]);
  eq.enableVinylScratch(true);
  expect(await eq.prepareVinylScratch()).toBe(true);
  expect(await eq.prepareVinylScratch()).toBe(true);
  expect(constructor).toHaveBeenCalledTimes(1);
  expect(graph.sources).toEqual([audio]);
  expect(worklet.port.postMessage).toHaveBeenCalledWith({ type: "enabled", enabled: true });
  expect(eq.startVinylScratch("track", 12)).toBe(false);
  eq.loadVinylScratchTrack("track", [new Float32Array(128)], 24_000);
  expect(eq.startVinylScratch("other-track", 12)).toBe(false);
  expect(eq.startVinylScratch("track", 12)).toBe(true);
  expect(worklet.port.postMessage).toHaveBeenLastCalledWith({
    type: "start",
    trackId: "track",
    position: 12,
    gain: 0.6,
  });
  eq.moveVinylScratch(11.8, 0.016);
  expect(worklet.port.postMessage).toHaveBeenLastCalledWith({
    type: "move",
    position: 11.8,
    seconds: 0.016,
  });
  eq.endVinylScratch();
  expect(worklet.port.postMessage).toHaveBeenLastCalledWith({ type: "end" });
  eq.enableVinylScratch(false);
  expect(eq.startVinylScratch("track", 12)).toBe(false);
  worklet.onprocessorerror?.();
  expect(graph.input.disconnect).toHaveBeenCalledWith(worklet);
  expect(graph.input.connect).toHaveBeenLastCalledWith(graph.filters[0]);
});

it("leaves the dry output connected when loading the scratch processor fails", async () => {
  vi.stubGlobal("AudioWorkletNode", vi.fn());
  const eq = await import("./equalizer");
  eq.connectEqualizer([{} as HTMLMediaElement]);
  eq.useEqualizer().setEnabled(true);
  graph.audioWorklet.addModule.mockRejectedValue(new Error("offline"));
  expect(await eq.prepareVinylScratch()).toBe(false);
  expect(graph.gain.disconnect).not.toHaveBeenCalled();
  expect(eq.startVinylScratch("track", 12)).toBe(false);
});

it("does not initialize Web Audio for scratching on unsupported browsers", async () => {
  vi.stubGlobal("AudioWorkletNode", undefined);
  const eq = await import("./equalizer");
  eq.connectEqualizer([{} as HTMLMediaElement]);
  expect(eq.vinylScratchSupported()).toBe(false);
  expect(await eq.prepareVinylScratch()).toBe(false);
  expect(AudioContext).not.toHaveBeenCalled();
});

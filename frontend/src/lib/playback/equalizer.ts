// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { useSyncExternalStore } from "react";
import { readStoredJson, writeStored } from "@/lib/storage";
import {
  EQ_BANDS,
  EQ_PRESETS,
  DEFAULT_EQUALIZER,
  clampGain,
  equalizerState,
  effectivePreamp,
  type EqualizerState,
  type EqualizerPreset,
} from "./equalizer-model";
export { EQ_BANDS, EQ_LIMIT_DB, EQ_PRESETS, type EqualizerPreset } from "./equalizer-model";

const STORAGE_KEY = "music-streaming.equalizer";

const OFF = DEFAULT_EQUALIZER;

function readState(): EqualizerState {
  return equalizerState(readStoredJson(STORAGE_KEY));
}

let state: EqualizerState = OFF;
let loaded = false;
const listeners = new Set<() => void>();

function current(): EqualizerState {
  if (!loaded && typeof window !== "undefined") {
    state = readState();
    loaded = true;
  }
  return state;
}

function update(next: EqualizerState): void {
  state = next;
  writeStored(STORAGE_KEY, JSON.stringify(next));
  apply();
  for (const listener of listeners) listener();
}

function equalizerSupported(): boolean {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return false;

  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return !ios;
}

let context: AudioContext | null = null;
let filters: BiquadFilterNode[] = [];
let preamp: GainNode | null = null;
let inputMix: GainNode | null = null;
let analyser: AnalyserNode | null = null;
let transientAnalyser: AnalyserNode | null = null;
let scratch: AudioWorkletNode | null = null;
let scratchLoading: Promise<boolean> | null = null;
let scratchEnabled = false;
let scratchTrackId: string | null = null;

const ANALYSER_BIN_HZ = 12;
let elements: HTMLMediaElement[] = [];
const attached = new WeakSet<HTMLMediaElement>();

function ensureGraph(): void {
  if (!equalizerSupported() || elements.length === 0) return;

  if (!context) {
    context = new AudioContext();
    filters = EQ_BANDS.map((frequency, band) => {
      const filter = context!.createBiquadFilter();
      filter.type =
        band === 0 ? "lowshelf" : band === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
      filter.frequency.value = frequency;
      filter.Q.value = Math.SQRT2;
      return filter;
    });
    preamp = context.createGain();
    inputMix = context.createGain();
    inputMix.connect(filters[0]);

    for (let band = 1; band < filters.length; band++) filters[band - 1].connect(filters[band]);
    filters[filters.length - 1].connect(preamp).connect(context.destination);
  }

  for (const element of elements) {
    if (attached.has(element)) continue;
    context.createMediaElementSource(element).connect(inputMix!);
    attached.add(element);
  }

  void context.resume().catch(() => {});
  apply();
}

export function vinylScratchSupported(): boolean {
  return equalizerSupported() && typeof AudioWorkletNode !== "undefined" && window.isSecureContext;
}

export function prepareVinylScratch(): Promise<boolean> {
  if (!vinylScratchSupported()) return Promise.resolve(false);
  if (scratch) {
    void context?.resume().catch(() => {});
    return Promise.resolve(true);
  }
  if (scratchLoading) return scratchLoading;
  ensureGraph();
  const graph = context;
  const input = inputMix;
  if (!graph?.audioWorklet || !input) return Promise.resolve(false);

  scratchLoading = graph.audioWorklet
    .addModule("/audio/vinyl-deck.js")
    .then(() => {
      const node = new AudioWorkletNode(graph, "vinyl-deck", { outputChannelCount: [2] });
      // Keep dry audio connected until the processor is ready. Reuse the existing
      // media sources so the equalizer and scratch effect can coexist.
      input.disconnect(filters[0]);
      input.connect(node).connect(filters[0]);
      scratch = node;
      node.port.postMessage({ type: "enabled", enabled: scratchEnabled });
      node.onprocessorerror = () => {
        input.disconnect(node);
        node.disconnect();
        input.connect(filters[0]);
        scratch = null;
        scratchTrackId = null;
        scratchLoading = null;
      };
      return true;
    })
    .catch(() => {
      scratchLoading = null;
      return false;
    });
  return scratchLoading;
}

export function enableVinylScratch(enabled: boolean): void {
  scratchEnabled = enabled;
  if (!enabled) scratchTrackId = null;
  scratch?.port.postMessage({ type: "enabled", enabled });
}

export function loadVinylScratchTrack(
  trackId: string,
  channels: Float32Array[],
  sampleRate: number,
): boolean {
  if (!scratch || !scratchEnabled) return false;
  scratch.port.postMessage(
    { type: "load", trackId, channels, sampleRate },
    channels.map((channel) => channel.buffer),
  );
  scratchTrackId = trackId;
  return true;
}

export function unloadVinylScratchTrack(): void {
  scratchTrackId = null;
  scratch?.port.postMessage({ type: "unload" });
}

export function startVinylScratch(trackId: string, position: number): boolean {
  if (!scratch || !scratchEnabled || scratchTrackId !== trackId) return false;
  const audio = elements.find((element) => element.dataset.trackId === trackId);
  if (!audio || audio.muted) return false;
  void context?.resume().catch(() => {});
  scratch.port.postMessage({ type: "start", trackId, position, gain: audio.volume });
  return true;
}

export function moveVinylScratch(position: number, seconds: number): void {
  scratch?.port.postMessage({ type: "move", position, seconds });
}

export function setVinylCrossfader(value: number): void {
  scratch?.port.postMessage({ type: "fader", value });
}

export function endVinylScratch(): void {
  scratch?.port.postMessage({ type: "end" });
}

export function resetVinylScratch(): void {
  scratch?.port.postMessage({ type: "reset" });
}

function apply(): void {
  if (!context || !preamp) return;

  const gains = state.enabled ? state.gains : EQ_PRESETS.flat;
  gains.forEach((gain, band) =>
    filters[band].gain.setTargetAtTime(gain, context!.currentTime, 0.02),
  );

  preamp.gain.setTargetAtTime(10 ** (effectivePreamp(state) / 20), context.currentTime, 0.02);
}

export function audioAnalyser(profile: "ambient" | "transients" = "ambient"): AnalyserNode | null {
  if (!equalizerSupported() || elements.length === 0) return null;

  if (!context) {
    if (!navigator.userActivation?.isActive) return null;
    ensureGraph();
  }

  let selected = profile === "transients" ? transientAnalyser : analyser;
  if (!selected && context && preamp) {
    selected = context.createAnalyser();
    selected.fftSize =
      profile === "transients"
        ? 2048
        : Math.min(32_768, 2 ** Math.ceil(Math.log2(context.sampleRate / ANALYSER_BIN_HZ)));
    selected.minDecibels = -85;
    // Short windows and spare headroom preserve attacks in dense recordings.
    selected.maxDecibels = profile === "transients" ? -6 : -22;
    selected.smoothingTimeConstant = profile === "transients" ? 0.12 : 0.7;
    preamp.connect(selected);
    if (profile === "transients") transientAnalyser = selected;
    else analyser = selected;
  }

  return selected;
}

function attachOnGesture(): void {
  const attach = () => {
    window.removeEventListener("pointerdown", attach, true);
    window.removeEventListener("keydown", attach, true);
    if (current().enabled) ensureGraph();
  };

  window.addEventListener("pointerdown", attach, true);
  window.addEventListener("keydown", attach, true);
}

export function connectEqualizer(media: HTMLMediaElement[]): void {
  elements = media;

  if (context) ensureGraph();
  else if (current().enabled) attachOnGesture();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const noop = () => () => {};

export function useEqualizer() {
  const snapshot = useSyncExternalStore(subscribe, current, () => OFF);
  const supported = useSyncExternalStore(noop, equalizerSupported, () => false);

  const preset = (Object.keys(EQ_PRESETS) as EqualizerPreset[]).find((name) =>
    EQ_PRESETS[name].every((gain, band) => gain === snapshot.gains[band]),
  );

  return {
    ...snapshot,
    effectivePreampDb: effectivePreamp(snapshot),
    supported,
    preset,
    setEnabled(enabled: boolean) {
      update({ ...current(), enabled });
      if (enabled) ensureGraph();
    },
    setGain(band: number, gain: number) {
      update({
        ...current(),
        gains: current().gains.map((value, index) => (index === band ? clampGain(gain) : value)),
      });
    },
    applyPreset(name: EqualizerPreset) {
      update({ ...current(), gains: EQ_PRESETS[name] });
    },
    setPreamp(preampDb: number) {
      update({ ...current(), preampDb: clampGain(preampDb) });
    },
    setAutoHeadroom(autoHeadroom: boolean) {
      update({ ...current(), autoHeadroom });
    },
    reset() {
      update({ ...DEFAULT_EQUALIZER, enabled: current().enabled });
    },
  };
}

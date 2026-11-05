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
let analyser: AnalyserNode | null = null;

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

    for (let band = 1; band < filters.length; band++) filters[band - 1].connect(filters[band]);
    filters[filters.length - 1].connect(preamp).connect(context.destination);
  }

  for (const element of elements) {
    if (attached.has(element)) continue;
    context.createMediaElementSource(element).connect(filters[0]);
    attached.add(element);
  }

  void context.resume().catch(() => {});
  apply();
}

function apply(): void {
  if (!context || !preamp) return;

  const gains = state.enabled ? state.gains : EQ_PRESETS.flat;
  gains.forEach((gain, band) =>
    filters[band].gain.setTargetAtTime(gain, context!.currentTime, 0.02),
  );

  preamp.gain.setTargetAtTime(10 ** (effectivePreamp(state) / 20), context.currentTime, 0.02);
}

export function audioAnalyser(): AnalyserNode | null {
  if (!equalizerSupported() || elements.length === 0) return null;

  if (!context) {
    if (!navigator.userActivation?.isActive) return null;
    ensureGraph();
  }

  if (!analyser && context && preamp) {
    analyser = context.createAnalyser();
    analyser.fftSize = Math.min(
      32_768,
      2 ** Math.ceil(Math.log2(context.sampleRate / ANALYSER_BIN_HZ)),
    );
    analyser.minDecibels = -85;
    analyser.maxDecibels = -22;
    analyser.smoothingTimeConstant = 0.7;
    preamp.connect(analyser);
  }

  return analyser;
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

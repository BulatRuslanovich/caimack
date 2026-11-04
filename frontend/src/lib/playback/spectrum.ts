// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

export function bandBins(
  bands: number,
  sampleRate: number,
  fftSize: number,
  lowHz = 40,
  highHz = 12_000,
): [number, number][] {
  const binHz = sampleRate / fftSize;
  const lastBin = fftSize / 2 - 1;
  const ratio = (highHz / lowHz) ** (1 / bands);
  const result: [number, number][] = [];

  for (let band = 0; band < bands; band++) {
    const from = Math.min(lastBin, Math.floor((lowHz * ratio ** band) / binHz));
    const to = Math.min(
      lastBin,
      Math.max(from + 1, Math.floor((lowHz * ratio ** (band + 1)) / binHz)),
    );
    result.push([from, to]);
  }

  return result;
}

export function bandLevel(data: Uint8Array, [from, to]: [number, number]): number {
  let sum = 0;
  for (let bin = from; bin < to; bin++) sum += data[bin];

  const level = sum / (to - from) / 255;
  return level ** 1.6;
}

export function follow(current: number, target: number, attack = 0.55, release = 0.12): number {
  return current + (target - current) * (target > current ? attack : release);
}

export function beatPulse(positionSeconds: number, bpm: number, offsetSeconds = 0): number {
  if (bpm <= 0) return 0;

  const beats = ((positionSeconds - offsetSeconds) * bpm) / 60;
  const phase = beats - Math.floor(beats);
  return Math.exp(-phase * 5);
}

export function onset(bass: number, average: number): number {
  return Math.max(0, Math.min(1, (bass - average * 1.08) * 4));
}

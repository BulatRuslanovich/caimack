// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_LIMIT_DB = 12;
export const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  vocal: [-3, -2, -1, 0, 2, 3, 4, 3, 1, 0],
  treble: [0, 0, 0, 0, 0, 0, 1, 3, 5, 6],
  rock: [4, 3, 2, 0, -2, -1, 1, 3, 4, 3],
  electronic: [5, 4, 2, 0, -2, 0, 2, 3, 4, 4],
  acoustic: [2, 2, 1, 1, 2, 2, 3, 2, 1, 1],
  warm: [3, 3, 2, 1, 0, 0, -1, -2, -3, -3],
} as const satisfies Record<string, readonly number[]>;

export type EqualizerPreset = keyof typeof EQ_PRESETS;
export interface EqualizerState {
  enabled: boolean;
  gains: readonly number[];
  preampDb: number;
  autoHeadroom: boolean;
}

export const DEFAULT_EQUALIZER: EqualizerState = {
  enabled: false,
  gains: EQ_PRESETS.flat,
  preampDb: 0,
  autoHeadroom: true,
};

export function clampGain(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(-EQ_LIMIT_DB, Math.min(EQ_LIMIT_DB, Math.round(value))) || 0
    : 0;
}

export function equalizerState(saved: unknown): EqualizerState {
  if (!saved || typeof saved !== "object") return DEFAULT_EQUALIZER;
  const value = saved as Partial<EqualizerState>;
  let gains: readonly number[] = EQ_PRESETS.flat;
  if (Array.isArray(value.gains)) {
    const old = value.gains.map(clampGain);
    if (old.length === EQ_BANDS.length) gains = old;
    else if (old.length === 5) {
      const frequencies = [60, 230, 910, 3600, 14000];
      gains = EQ_BANDS.map((hz) => {
        if (hz <= frequencies[0]) return old[0];
        const upper = frequencies.findIndex((frequency) => frequency >= hz);
        if (upper < 0) return old[old.length - 1];
        const fraction =
          Math.log(hz / frequencies[upper - 1]) /
          Math.log(frequencies[upper] / frequencies[upper - 1]);
        return clampGain(old[upper - 1] + fraction * (old[upper] - old[upper - 1]));
      });
    }
  }
  return {
    enabled: value.enabled === true,
    gains,
    preampDb: clampGain(value.preampDb),
    autoHeadroom: value.autoHeadroom !== false,
  };
}

export function effectivePreamp(state: EqualizerState): number {
  if (!state.enabled) return 0;
  return state.autoHeadroom
    ? Math.min(state.preampDb, -Math.max(0, ...state.gains))
    : state.preampDb;
}

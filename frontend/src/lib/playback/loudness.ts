// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { Track } from "@/lib/types";

export const NORMALIZE_TARGET_LUFS = -18;

export function normalizationGain(
  track: Pick<Track, "loudness"> | null | undefined,
  enabled: boolean,
): number {
  const lufs = track?.loudness?.lufs;
  if (!enabled || lufs === undefined || !Number.isFinite(lufs)) return 1;

  return Math.min(1, 10 ** ((NORMALIZE_TARGET_LUFS - lufs) / 20));
}

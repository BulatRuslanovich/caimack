// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { MOTION_BANDS } from "./audioMotion";

export function softBand(spectrum: Float32Array, index: number): number {
  return (
    spectrum[Math.max(0, index - 1)] * 0.2 +
    spectrum[index] * 0.6 +
    spectrum[Math.min(MOTION_BANDS - 1, index + 1)] * 0.2
  );
}

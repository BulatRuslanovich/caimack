// SPDX-License-Identifier: AGPL-3.0-only
import type { AudioMotionFrame } from "./audioMotion";

// These spectrum envelopes retain the measured amplitude of the recording.
// The three normalized bass/mid/high controls deliberately do not: they make
// quiet notes readable and are too strong for a material's continuous force.
export function materialLevels(
  frame: Pick<AudioMotionFrame, "bass" | "mid" | "high"> &
    Partial<Pick<AudioMotionFrame, "spectrum" | "drive">>,
): [number, number, number] {
  if (!frame.spectrum) return [frame.bass, frame.mid, frame.high];
  const ranges = [
    [0, 9],
    [9, 18],
    [18, 24],
  ];
  const weight = 0.25 + (frame.drive ?? 0) * 0.75;
  return ranges.map(([from, to]) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += frame.spectrum![i];
    return Math.min(1, Math.max(0, (sum / (to - from)) * weight));
  }) as [number, number, number];
}

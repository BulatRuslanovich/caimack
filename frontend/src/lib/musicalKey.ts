// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { MusicalKey } from "@/lib/types";

const TONICS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

export function keyName(key: Pick<MusicalKey, "tonic" | "minor">): string {
  return `${key.tonic}${key.minor ? "m" : ""}`;
}

export const CAMELOT_KEYS: { camelot: string; name: string }[] = Array.from(
  { length: 12 },
  (_, index) => index + 1,
).flatMap((number) => {
  const major = (((number + 4) % 12) * 7) % 12;
  const minor = (major + 9) % 12;
  return [
    { camelot: `${number}A`, name: keyName({ tonic: TONICS[minor], minor: true }) },
    { camelot: `${number}B`, name: keyName({ tonic: TONICS[major], minor: false }) },
  ];
});

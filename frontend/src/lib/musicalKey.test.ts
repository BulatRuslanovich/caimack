// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { CAMELOT_KEYS, keyName } from "@/lib/musicalKey";

describe("CAMELOT_KEYS", () => {
  it("lists all 24 keys around the wheel", () => {
    expect(CAMELOT_KEYS).toHaveLength(24);
    expect(new Set(CAMELOT_KEYS.map((key) => key.name)).size).toBe(24);
  });

  it("matches the Camelot chart", () => {
    const named = Object.fromEntries(CAMELOT_KEYS.map((key) => [key.camelot, key.name]));
    expect(named).toMatchObject({
      "8A": "Am",
      "8B": "C",
      "9B": "G",
      "7B": "F",
      "1A": "Abm",
      "4A": "Fm",
    });
  });
});

describe("keyName", () => {
  it("marks minor keys", () => {
    expect(keyName({ tonic: "F#", minor: true })).toBe("F#m");
    expect(keyName({ tonic: "Eb", minor: false })).toBe("Eb");
  });
});

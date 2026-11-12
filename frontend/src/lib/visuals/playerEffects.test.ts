// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { PLAYER_EFFECTS, playerEffectsState } from "@/lib/playerEffects";
import { effectPalette } from "./effectPalette";

describe("playback visual preferences", () => {
  it("accepts each effect and repairs corrupt stored preferences", () => {
    for (const effect of [...PLAYER_EFFECTS, "off"]) {
      expect(playerEffectsState({ effect, intensity: 45 })).toEqual({
        effect,
        intensity: 35,
        sensitivity: 65,
      });
    }
    expect(playerEffectsState({ effect: "invalid", intensity: Number.NaN })).toEqual(
      playerEffectsState(null),
    );
    expect(playerEffectsState({ effect: "aurora", intensity: 200 }).intensity).toBe(100);
    expect(playerEffectsState({ effect: "glass", intensity: -3 }).intensity).toBe(0);
    expect(playerEffectsState({ effect: "water", intensity: 45, sensitivity: 80 })).toEqual({
      effect: "glass",
      intensity: 35,
      sensitivity: 85,
    });
    expect(playerEffectsState({ effect: "ink" }).effect).toBe("glass");
    expect(playerEffectsState({ effect: "fabric", sensitivity: 200 }).effect).toBe("glass");
    expect(playerEffectsState({ sensitivity: -10 }).sensitivity).toBe(0);
    expect(playerEffectsState({ sensitivity: 200 }).sensitivity).toBe(100);
  });
});

describe("cover colours for playback effects", () => {
  it("extracts warm and cool colours from the cover rather than transparent or grey pixels", () => {
    const colors = effectPalette(
      [210, 75, 30, 255, 30, 100, 210, 255, 220, 220, 220, 255, 0, 255, 0, 0],
      [180, 200, 220],
    );
    expect(colors.some(([r, g, b]) => r > g * 1.5 && r > b * 1.5)).toBe(true);
    expect(colors.some(([r, g, b]) => b > r * 1.5 && b > g * 1.5)).toBe(true);
    expect(
      colors.every((color) =>
        color.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255),
      ),
    ).toBe(true);
  });
  it("keeps a usable palette for monochrome covers, missing covers and empty images", () => {
    for (const pixels of [[], [0, 0, 0, 255], [128, 128, 128, 255]]) {
      const colors = effectPalette(pixels, [180, 200, 220]);
      expect(colors).toHaveLength(3);
      expect(colors[0]).toEqual([180, 200, 220]);
    }
  });
});

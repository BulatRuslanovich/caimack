// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { createEffectLayout, GLASS_LENSES, INK_FLOWS } from "./effectLayout";

describe("stable material layouts", () => {
  it("retains the same surface for a track and gives another track a different surface", () => {
    const first = createEffectLayout("Dirtmouth");
    expect(createEffectLayout("Dirtmouth")).toEqual(first);
    const second = createEffectLayout("Eyeless");
    expect(second.lenses).not.toEqual(first.lenses);
    expect(second.ink).not.toEqual(first.ink);
  });
  it("covers every frequency with finite, usable lenses and flow centres", () => {
    for (const key of ["", "Remains", "тест"]) {
      const layout = createEffectLayout(key);
      expect(layout.lenses).toHaveLength(GLASS_LENSES * 4);
      expect(layout.ink).toHaveLength(INK_FLOWS * 4);
      const frequencies = [];
      for (let i = 0; i < GLASS_LENSES; i++) {
        expect(layout.lenses[i * 4]).toBeGreaterThan(0);
        expect(layout.lenses[i * 4 + 1]).toBeLessThan(1);
        expect(layout.lenses[i * 4 + 2]).toBeGreaterThan(0.1);
        expect(Math.hypot(layout.optics[i * 4], layout.optics[i * 4 + 1])).toBeCloseTo(1);
        frequencies.push(layout.optics[i * 4 + 3]);
      }
      expect(new Set(frequencies).size).toBe(GLASS_LENSES);
      expect(layout.ink[2]).toBeGreaterThan(layout.ink[(INK_FLOWS - 1) * 4 + 2] * 3);
    }
  });
});

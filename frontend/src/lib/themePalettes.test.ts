// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  COLORWAYS,
  COLORWAY_STORAGE_KEY,
  NO_FLASH_THEME_SCRIPT,
  THEME_COLORS,
  THEME_STORAGE_KEY,
} from "./themeScript";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../app/styles/theme.css") + read("../app/styles/colorways.css");
const android = read("../../../android/app/src/main/kotlin/app/caimack/ui/Theme.kt");
const palettes = [...css.matchAll(/([^{}]+)\{([^{}]*--background: #[^{}]+)\}/g)].map(
  ([, header, body]) => ({
    name: header.match(/data-colorway(?:-preview)?="(\w+)"/)?.[1] ?? "coffee",
    mode: header.includes('"light"') ? "light" : "dark",
    tokens: Object.fromEntries(
      [...body.matchAll(/--([\w-]+): (#[\da-f]{6});/g)].map(([, k, v]) => [k, v]),
    ),
    body,
  }),
);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (rgb: number[]) =>
  rgb
    .map((v) => v / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: number[], b: number[]) => {
  const [lo, hi] = [luminance(a), luminance(b)].sort((a, b) => a - b);
  return (hi + 0.05) / (lo + 0.05);
};

describe("shared application palettes", () => {
  it("covers both modes of every fixed colorway", () => {
    for (const name of COLORWAYS.filter((colorway) => colorway !== "cover")) {
      expect(
        palettes
          .filter((p) => p.name === name)
          .map((p) => p.mode)
          .sort(),
      ).toEqual(["dark", "light"]);
    }
  });
  it.each(["dark", "light"] as const)(
    "restores the cover palette in %s mode before art loads",
    (theme) => {
      const dataset = {};
      const setAttribute = vi.fn();
      const preferences = new Map([
        [COLORWAY_STORAGE_KEY, "cover"],
        [THEME_STORAGE_KEY, theme],
      ]);
      runInNewContext(NO_FLASH_THEME_SCRIPT, {
        document: { documentElement: { dataset }, querySelector: () => ({ setAttribute }) },
        localStorage: { getItem: (key: string) => preferences.get(key) ?? null },
      });
      expect(dataset).toEqual({ theme, colorway: "cover" });
      expect(setAttribute).toHaveBeenCalledWith("content", THEME_COLORS.coffee[theme]);
    },
  );
  for (const { name, mode, tokens, body } of palettes) {
    it(`${name} ${mode}: readable content, selected labels and actions`, () => {
      for (const surface of ["background", "card", "popover", "surface-raised", "accent"])
        for (const text of [
          "foreground",
          "muted-foreground",
          "faint-foreground",
          "primary",
          "destructive",
          "warning",
          "success",
        ])
          expect(
            contrast(rgb(tokens[text]), rgb(tokens[surface])),
            `${text} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
      for (const [text, surface] of [
        ["primary-foreground", "primary"],
        ["action-foreground", "action"],
        ["action-foreground", "action-hover"],
      ])
        expect(
          contrast(rgb(tokens[text]), rgb(tokens[surface])),
          `${text} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      const soft = body.match(/--primary-soft: rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)/)!;
      const alpha = Number(soft[4]) / 100;
      const selected = rgb(tokens.card).map(
        (channel, i) => channel * (1 - alpha) + Number(soft[i + 1]) * alpha,
      );
      expect(contrast(rgb(tokens.primary), selected), "selected label").toBeGreaterThanOrEqual(4.5);
    });
    it(`${name} ${mode}: Android, web and browser chrome agree`, () => {
      const className =
        name[0].toUpperCase() + name.slice(1) + (mode === "dark" ? "Dark" : "Light");
      const block = android.match(
        new RegExp(`private val ${className} = Palette\\(([\\s\\S]*?)\\n\\)`),
      )![1];
      const names: Record<string, string> = {
        raised: "surface-raised",
        muted: "muted-foreground",
        faint: "faint-foreground",
        onPrimary: "primary-foreground",
        onAction: "action-foreground",
      };
      for (const [, key, value] of block.matchAll(/(\w+) = Color\(0xFF([\dA-F]{6})\)/g))
        expect(tokens[names[key] ?? key], key).toBe(`#${value.toLowerCase()}`);
      const sleeves = block.match(/sleeves = listOf\(([\s\S]*?)\n\s*\),/);
      const sleeveColors = [...(sleeves?.[1] ?? "").matchAll(/0xFF([\dA-F]{6})/g)].map(
        ([, value]) => `#${value.toLowerCase()}`,
      );
      expect(sleeveColors).toEqual(
        Array.from({ length: 6 }, (_, index) => tokens[`sleeve-${index}`]),
      );
      expect(THEME_COLORS[name as keyof typeof THEME_COLORS][mode as "dark" | "light"]).toBe(
        tokens.background,
      );
    });
  }
});

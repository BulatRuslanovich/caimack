// SPDX-License-Identifier: AGPL-3.0-only

export const THEME_STORAGE_KEY = "music-streaming.theme";

export const COLORWAY_STORAGE_KEY = "music-streaming.colorway";

export const COVER_TONE_STORAGE_KEY = "music-streaming.cover-tone";

export const PALETTES = ["dark", "light"] as const;

export type Palette = (typeof PALETTES)[number];

export const COLORWAYS = [
  "coffee",
  "graphite",
  "midnight",
  "plum",
  "studio",
  "dodo",
  "cover",
] as const;

export type Colorway = (typeof COLORWAYS)[number];

export const DEFAULT_COLORWAY: Colorway = "coffee";

const COFFEE_COLORS = { dark: "#1d1916", light: "#f3e9dc" };

export const THEME_COLORS: Record<Colorway, Record<Palette, string>> = {
  coffee: COFFEE_COLORS,
  graphite: { dark: "#000000", light: "#eeeeee" },
  midnight: { dark: "#151e2c", light: "#e8eff8" },
  plum: { dark: "#241a2f", light: "#f2e9f3" },
  studio: { dark: "#172219", light: "#ebeee3" },
  dodo: { dark: "#201813", light: "#fff0e2" },
  cover: COFFEE_COLORS,
};

export const NO_FLASH_THEME_SCRIPT = `try {
  var colors = ${JSON.stringify(THEME_COLORS)};
  var saved = localStorage.getItem("${THEME_STORAGE_KEY}");
  var palette = saved === "system"
    ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : saved;
  if (palette !== "dark" && palette !== "light") palette = "dark";
  var colorway = localStorage.getItem("${COLORWAY_STORAGE_KEY}");
  if (!Object.hasOwn(colors, colorway)) colorway = "${DEFAULT_COLORWAY}";
  document.documentElement.dataset.theme = palette;
  document.documentElement.dataset.colorway = colorway;
  var density = localStorage.getItem("music-streaming.library-density");
  if (density === "compact" || density === "spacious") document.documentElement.dataset.libraryDensity = density;
  if (localStorage.getItem("${COVER_TONE_STORAGE_KEY}") === "off") document.documentElement.dataset.coverTone = "off";
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", colors[colorway][palette]);
} catch (e) {}`;

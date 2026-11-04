// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

export const THEME_STORAGE_KEY = "music-streaming.theme";

export const COLORWAY_STORAGE_KEY = "music-streaming.colorway";

export const COVER_TONE_STORAGE_KEY = "music-streaming.cover-tone";

export const PALETTES = ["dark", "light"] as const;

export type Palette = (typeof PALETTES)[number];

export const COLORWAYS = ["coffee", "graphite", "midnight", "plum", "studio"] as const;

export type Colorway = (typeof COLORWAYS)[number];

export const DEFAULT_COLORWAY: Colorway = "coffee";

export const THEME_COLORS: Record<Colorway, Record<Palette, string>> = {
  coffee: { dark: "#171819", light: "#eeefec" },
  graphite: { dark: "#000000", light: "#f2f0eb" },
  midnight: { dark: "#0e121a", light: "#eceff5" },
  plum: { dark: "#161119", light: "#f5eef0" },
  studio: { dark: "#0f1311", light: "#edf1ed" },
};

export const NO_FLASH_THEME_SCRIPT = `try {
  var colors = ${JSON.stringify(THEME_COLORS)};
  var saved = localStorage.getItem("${THEME_STORAGE_KEY}");
  var palette = saved === "system"
    ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : saved;
  if (palette !== "dark" && palette !== "light") palette = "dark";
  var colorway = localStorage.getItem("${COLORWAY_STORAGE_KEY}");
  if (!colors[colorway]) colorway = "${DEFAULT_COLORWAY}";
  document.documentElement.dataset.theme = palette;
  document.documentElement.dataset.colorway = colorway;
  var density = localStorage.getItem("music-streaming.library-density");
  if (density === "compact" || density === "spacious") document.documentElement.dataset.libraryDensity = density;
  if (localStorage.getItem("${COVER_TONE_STORAGE_KEY}") === "off") document.documentElement.dataset.coverTone = "off";
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", colors[colorway][palette]);
} catch (e) {}`;

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useSyncExternalStore } from "react";
import { readStored, writeStored } from "@/lib/storage";
import {
  COLORWAY_STORAGE_KEY,
  COLORWAYS,
  COVER_TONE_STORAGE_KEY,
  DEFAULT_COLORWAY,
  PALETTES,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  type Colorway,
  type Palette,
} from "./themeScript";

export const THEME_CHOICES = ["system", ...PALETTES] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

const LIGHT_QUERY = "(prefers-color-scheme: light)";

let choice: ThemeChoice | null = null;

let colorway: Colorway | null = null;

let coverTone: boolean | null = null;

const listeners = new Set<() => void>();

function isChoice(value: string | null): value is ThemeChoice {
  return value !== null && (THEME_CHOICES as readonly string[]).includes(value);
}

function isColorway(value: string | null): value is Colorway {
  return value !== null && (COLORWAYS as readonly string[]).includes(value);
}

function resolve(value: ThemeChoice): Palette {
  if (value !== "system") return value;

  return window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

function apply(): void {
  const palette = resolve(getChoice());
  const root = document.documentElement;

  root.dataset.theme = palette;
  root.dataset.colorway = getColorway();
  if (getCoverTone()) delete root.dataset.coverTone;
  else root.dataset.coverTone = "off";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[getColorway()][palette]);
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  const media = window.matchMedia(LIGHT_QUERY);
  const onSystemChange = () => {
    if (getChoice() !== "system") return;

    apply();
    notify();
  };

  media.addEventListener("change", onSystemChange);

  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onSystemChange);
  };
}

function getChoice(): ThemeChoice {
  if (choice === null) {
    const saved = readStored(THEME_STORAGE_KEY);
    choice = isChoice(saved) ? saved : "dark";
  }
  return choice;
}

function getColorway(): Colorway {
  if (colorway === null) {
    const saved = readStored(COLORWAY_STORAGE_KEY);
    colorway = isColorway(saved) ? saved : DEFAULT_COLORWAY;
  }
  return colorway;
}

function getCoverTone(): boolean {
  coverTone ??= readStored(COVER_TONE_STORAGE_KEY) !== "off";
  return coverTone;
}

function getSnapshot(): Palette {
  return resolve(getChoice());
}

export function setTheme(next: ThemeChoice): void {
  choice = next;
  apply();

  writeStored(THEME_STORAGE_KEY, next);

  notify();
}

export function setColorway(next: Colorway): void {
  colorway = next;
  apply();

  writeStored(COLORWAY_STORAGE_KEY, next);

  notify();
}

export function setCoverTone(next: boolean): void {
  coverTone = next;
  apply();

  writeStored(COVER_TONE_STORAGE_KEY, next ? null : "off");

  notify();
}

export function useTheme(): Palette {
  return useSyncExternalStore(subscribe, getSnapshot, () => "dark");
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, getChoice, () => "dark");
}

export function useColorway(): Colorway {
  return useSyncExternalStore(subscribe, getColorway, () => DEFAULT_COLORWAY);
}

export function useCoverToneEnabled(): boolean {
  return useSyncExternalStore(subscribe, getCoverTone, () => true);
}

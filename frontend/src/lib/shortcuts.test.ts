// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import {
  SEEK_STEP,
  SHORTCUT_HELP,
  SHORTCUT_VOLUME_STEP,
  isHelpShortcut,
  resolveShortcut,
} from "@/lib/shortcuts";

function press(
  key: string,
  modifiers: Partial<Record<"shift" | "alt" | "command", boolean>> & { code?: string } = {},
) {
  return resolveShortcut({
    key,
    code: modifiers.code,
    shiftKey: modifiers.shift ?? false,
    altKey: modifiers.alt ?? false,
    ctrlKey: modifiers.command ?? false,
    metaKey: false,
  });
}

describe("resolveShortcut", () => {
  it("toggles playback on space and k", () => {
    expect(press(" ")).toEqual({ action: "playPause" });
    expect(press("k")).toEqual({ action: "playPause" });
  });

  it("seeks with the arrows and nudges with j and l", () => {
    expect(press("ArrowRight")).toEqual({ action: "seekBy", value: SEEK_STEP });
    expect(press("ArrowLeft")).toEqual({ action: "seekBy", value: -SEEK_STEP });
  });

  it("changes track with shifted arrows", () => {
    expect(press("ArrowRight", { shift: true })).toEqual({ action: "next" });
    expect(press("ArrowLeft", { shift: true })).toEqual({ action: "previous" });
  });

  it("changes volume with plus and minus in both shift states", () => {
    expect(press("+", { shift: true })).toEqual({
      action: "volumeBy",
      value: SHORTCUT_VOLUME_STEP,
    });
    expect(press("=")).toEqual({ action: "volumeBy", value: SHORTCUT_VOLUME_STEP });
    expect(press("-")).toEqual({ action: "volumeBy", value: -SHORTCUT_VOLUME_STEP });
  });

  it("stays out of the way of browser shortcuts", () => {
    expect(press("ArrowLeft", { alt: true })).toBeNull();
    expect(press("r", { command: true })).toBeNull();
    expect(press("k", { command: true })).toBeNull();
    expect(press("s", { shift: true })).toBeNull();
  });

  it("keeps punctuation on the produced character, not the physical key", () => {
    expect(press("+", { shift: true, code: "Equal" })).toEqual({
      action: "volumeBy",
      value: SHORTCUT_VOLUME_STEP,
    });
  });

  it("ignores keys it does not know", () => {
    expect(press("x")).toBeNull();
    expect(press("Escape")).toBeNull();
  });
});

describe("isHelpShortcut", () => {
  const key = (value: string, extra: Partial<Parameters<typeof isHelpShortcut>[0]> = {}) => ({
    key: value,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...extra,
  });

  it("opens on a question mark", () => {
    expect(isHelpShortcut(key("?", { shiftKey: true, code: "Slash" }))).toBe(true);
  });

  it("opens on the physical question-mark key in a Russian layout", () => {
    expect(isHelpShortcut(key(",", { shiftKey: true, code: "Slash" }))).toBe(true);
  });

  it("does not toggle the dialog again while the key is held", () => {
    expect(isHelpShortcut(key("?", { shiftKey: true, code: "Slash", repeat: true }))).toBe(false);
  });

  it("ignores the slash key without shift and chords with command keys", () => {
    expect(isHelpShortcut(key("/", { code: "Slash" }))).toBe(false);
    expect(isHelpShortcut(key("?", { shiftKey: true, ctrlKey: true, code: "Slash" }))).toBe(false);
  });

  it("does not steal a key the player already uses", () => {
    expect(resolveShortcut(key("?", { shiftKey: true, code: "Slash" }))).toBeNull();
  });

  it("lists every help row once", () => {
    const rows = SHORTCUT_HELP.map((entry) => entry.keys.join());
    expect(new Set(rows).size).toBe(rows.length);
  });
});

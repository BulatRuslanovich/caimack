// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { TranslationKey } from "@/lib/i18n";

type ShortcutAction =
  | "playPause"
  | "seekBy"
  | "next"
  | "previous"
  | "volumeBy"
  | "mute"
  | "shuffle"
  | "repeat"
  | "queue";

interface ShortcutHit {
  action: ShortcutAction;
  value?: number;
}

interface KeyLike {
  key: string;
  code?: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
}

const ASCII_KEY = /^[a-z0-9]$/i;

function layoutSafeKey(event: KeyLike): string {
  if (ASCII_KEY.test(event.key)) return event.key.toLowerCase();

  const code = event.code ?? "";
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);

  return event.key;
}

export const SEEK_STEP = 5;

export const SHORTCUT_VOLUME_STEP = 0.05;

const NEEDS_TRACK: ReadonlySet<ShortcutAction> = new Set<ShortcutAction>([
  "playPause",
  "seekBy",
  "next",
  "previous",
]);

export function shortcutNeedsTrack(action: ShortcutAction): boolean {
  return NEEDS_TRACK.has(action);
}

const REPEATABLE: ReadonlySet<ShortcutAction> = new Set<ShortcutAction>(["seekBy", "volumeBy"]);

export function shortcutAcceptsRepeat(action: ShortcutAction): boolean {
  return REPEATABLE.has(action);
}

export function resolveShortcut(event: KeyLike): ShortcutHit | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  if (event.key === "+" || event.key === "=") {
    return { action: "volumeBy", value: SHORTCUT_VOLUME_STEP };
  }
  if (event.key === "-" || event.key === "_") {
    return { action: "volumeBy", value: -SHORTCUT_VOLUME_STEP };
  }

  if (event.shiftKey) {
    if (event.key === "ArrowRight") return { action: "next" };
    if (event.key === "ArrowLeft") return { action: "previous" };
    return null;
  }

  const key = layoutSafeKey(event);

  switch (key) {
    case " ":
    case "k":
      return { action: "playPause" };
    case "ArrowRight":
      return { action: "seekBy", value: SEEK_STEP };
    case "ArrowLeft":
      return { action: "seekBy", value: -SEEK_STEP };
    case "m":
      return { action: "mute" };
    case "s":
      return { action: "shuffle" };
    case "r":
      return { action: "repeat" };
    case "q":
      return { action: "queue" };
    default:
      return null;
  }
}

export function isHelpShortcut(event: KeyLike): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return false;

  return event.key === "?" || (event.shiftKey && event.code === "Slash");
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;

  return (
    element?.tagName === "INPUT" ||
    element?.tagName === "TEXTAREA" ||
    element?.isContentEditable === true
  );
}

export const SHORTCUT_HELP: ReadonlyArray<{
  keys: readonly string[];
  label: TranslationKey;
  values?: Record<string, number>;
}> = [
  { keys: ["Space", "K"], label: "shortcuts.playPause" },
  { keys: ["←", "→"], label: "shortcuts.seek", values: { seconds: SEEK_STEP } },
  { keys: ["Shift ←", "Shift →"], label: "shortcuts.track" },
  { keys: ["−", "+"], label: "shortcuts.volume" },
  { keys: ["M"], label: "shortcuts.mute" },
  { keys: ["S"], label: "shortcuts.shuffle" },
  { keys: ["R"], label: "shortcuts.repeat" },
  { keys: ["Q"], label: "shortcuts.queue" },
  { keys: ["/"], label: "shortcuts.search" },
  { keys: ["?"], label: "shortcuts.help" },
];

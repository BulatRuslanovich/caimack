// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

export const ACCEPTED_EXTENSIONS = [".mp3", ".flac"] as const;

export const ACCEPT_ATTRIBUTE = ".mp3,.flac,audio/mpeg,audio/flac";

export function extensionOf(fileName: string): string {
  return /\.[a-z0-9]+$/i.exec(fileName)?.[0].toLowerCase() ?? "";
}

export function isAcceptedAudio(fileName: string): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

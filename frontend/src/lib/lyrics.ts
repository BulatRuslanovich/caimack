// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { LyricLine, LyricWord, Lyrics } from "./types";

export function activeLineAt(lines: readonly LyricLine[], at: number): number {
  let low = 0;
  let high = lines.length;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (lines[middle].at <= at) low = middle + 1;
    else high = middle;
  }

  return low - 1;
}

export function toLrc(lyrics: Lyrics): string {
  if (lyrics.lines.length === 0) return lyrics.plain;

  return lyrics.lines
    .map((line) => {
      if (!line.words?.length) return `${stamp(line.at)}${line.text}`;
      const words = line.words
        .map((word, i) => {
          const next = line.words?.[i + 1];
          const close = !next || next.at > word.end ? angleStamp(word.end) : "";
          return `${angleStamp(word.at)}${word.text}${close}`;
        })
        .join("");
      return `${stamp(line.at)}${words}`;
    })
    .join("\n");
}

const angleStamp = (at: number) => stamp(at).replace("[", "<").replace("]", ">");

export function wordProgress(word: LyricWord, positionMs: number): number {
  if (!Number.isFinite(positionMs) || positionMs < word.at) return 0;
  if (word.end <= word.at || positionMs >= word.end) return 1;
  return Math.max(0, Math.min(1, (positionMs - word.at) / (word.end - word.at)));
}

/** Keeps frame updates outside React and repaints only active/crossed rows. */
export class WordPainter {
  private previous = new Set<number>();
  private previousIndex: number | null = null;
  private readonly prefixEnd: number[];

  constructor(
    private readonly lines: readonly LyricLine[],
    private readonly rows: HTMLElement[][],
  ) {
    let end = 0;
    this.prefixEnd = lines.map((line) => (end = Math.max(end, line.end ?? line.at)));
  }

  paint(positionMs: number, force = false) {
    const index = activeLineAt(this.lines, positionMs);
    const active = new Set<number>();
    for (let i = index; i >= 0 && this.prefixEnd[i] >= positionMs; i--) {
      if ((this.lines[i].end ?? this.lines[i].at) >= positionMs) active.add(i);
    }
    const changed = new Set(force ? this.lines.map((_, i) => i) : [...this.previous, ...active]);
    if (this.previousIndex !== null && index !== this.previousIndex) {
      for (
        let i = Math.max(0, Math.min(index, this.previousIndex));
        i <= Math.max(index, this.previousIndex);
        i++
      )
        changed.add(i);
    }
    for (const row of changed) {
      this.lines[row].words?.forEach((word, i) => {
        const element = this.rows[row]?.[i];
        if (!element) return;
        const fill = `${(wordProgress(word, positionMs) * 100).toFixed(2)}%`;
        if (element.style.getPropertyValue("--lyric-word-fill") !== fill)
          element.style.setProperty("--lyric-word-fill", fill);
      });
    }
    this.previous = active;
    this.previousIndex = index;
  }
}

function stamp(at: number): string {
  const minutes = Math.floor(at / 60_000);
  const seconds = Math.floor((at % 60_000) / 1000);
  const milliseconds = at % 1000;

  const fraction =
    milliseconds % 10 === 0 ? pad(milliseconds / 10) : String(milliseconds).padStart(3, "0");

  return `[${pad(minutes)}:${pad(seconds)}.${fraction}]`;
}

const pad = (value: number) => String(value).padStart(2, "0");

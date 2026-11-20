// SPDX-License-Identifier: AGPL-3.0-only

import { request } from "./http";

export interface AudiobookChapter {
  id: string;
  title: string;
  durationMs: number;
  sizeBytes: number;
  streamUrl: string;
}

export interface AudiobookProgress {
  chapterId: string;
  positionMs: number;
  updatedAtMs: number;
  completed: boolean;
}

export interface Audiobook {
  id: string;
  title: string;
  author: string | null;
  narrator: string | null;
  coverUrl: string | null;
  durationMs: number;
  chapters: AudiobookChapter[];
  saved: boolean;
  progress: AudiobookProgress | null;
}

export const audiobookHref = (id: string) => `/audiobooks/${encodeURIComponent(id)}` as const;

export const audiobookApi = {
  catalog: (signal?: AbortSignal) => request<Audiobook[]>("/audiobooks", { signal }),
  detail: (id: string, signal: AbortSignal) => request<Audiobook>(audiobookHref(id), { signal }),
  writeProgress: (id: string, body: AudiobookProgress) =>
    request<AudiobookProgress>(`${audiobookHref(id)}/progress`, {
      method: "PUT",
      body,
      keepalive: true,
    }),
  save: (id: string, saved: boolean) =>
    request<void>(`${audiobookHref(id)}/saved`, { method: saved ? "PUT" : "DELETE" }),
};

export function withLatestProgress(book: Audiobook, progress?: AudiobookProgress): Audiobook {
  if (
    progress &&
    progress.updatedAtMs > (book.progress?.updatedAtMs ?? 0) &&
    book.chapters.some((chapter) => chapter.id === progress.chapterId)
  ) {
    return { ...book, progress };
  }
  return book;
}

export function elapsedBookMs(book: Audiobook): number {
  if (book.progress?.completed) return book.durationMs;

  let elapsed = 0;
  for (const chapter of book.chapters) {
    if (chapter.id === book.progress?.chapterId) {
      return elapsed + Math.min(chapter.durationMs, book.progress.positionMs);
    }
    elapsed += chapter.durationMs;
  }
  return 0;
}

export type ProgressJournal = Record<string, { progress: AudiobookProgress; pending: boolean }>;

export function journalKey(userId: string) {
  return `caimack-audiobook-progress:${userId}`;
}

export function readProgressJournal(userId: string): ProgressJournal {
  try {
    return JSON.parse(localStorage.getItem(journalKey(userId)) ?? "{}") as ProgressJournal;
  } catch {
    return {};
  }
}

export function persistProgressJournal(userId: string, journal: ProgressJournal) {
  try {
    localStorage.setItem(journalKey(userId), JSON.stringify(journal));
  } catch {
    // A browser can disable storage. The active tab can still sync its progress.
  }
}

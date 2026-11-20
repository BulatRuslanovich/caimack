// SPDX-License-Identifier: AGPL-3.0-only

import { request } from "./http";
import type { AudiobookValues } from "./schemas";

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
  year?: number | null;
  coverUrl: string | null;
  durationMs: number;
  chapters: AudiobookChapter[];
  saved: boolean;
  savedAtMs?: number | null;
  progress: AudiobookProgress | null;
}

export const audiobookHref = (id: string) => `/audiobooks/${encodeURIComponent(id)}` as const;

function searchWords(value: string): string[] {
  return (
    value
      .normalize()
      .toLowerCase()
      .replaceAll("ё", "е")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

export function filterAudiobooks(books: Audiobook[], query: string): Audiobook[] {
  if (!query.trim()) return books;
  const words = searchWords(query);
  if (!words.length) return [];

  return books.filter(({ title, author, narrator }) => {
    const fields = searchWords([title, author, narrator].join(" ")).join(" ");
    return words.every((word) => fields.includes(word));
  });
}

export const audiobookApi = {
  catalog: (signal?: AbortSignal, onResponse?: (headers: Headers) => void) =>
    request<Audiobook[]>("/audiobooks", { signal, onResponse }),
  detail: (id: string, signal: AbortSignal, onResponse?: (headers: Headers) => void) =>
    request<Audiobook>(audiobookHref(id), { signal, onResponse }),
  edit: (id: string, values: AudiobookValues, cover: File | null, removeCover: boolean) => {
    const body = new FormData();
    body.set("details", JSON.stringify({ ...values, removeCover }));
    if (cover) body.set("file", cover);
    return request<void>(audiobookHref(id), { method: "PUT", body });
  },
  writeProgress: (
    id: string,
    body: AudiobookProgress,
    signal: AbortSignal,
    onResponse?: (headers: Headers) => void,
  ) =>
    request<AudiobookProgress>(`${audiobookHref(id)}/progress`, {
      method: "PUT",
      body,
      keepalive: true,
      signal,
      onResponse,
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

export function audiobookTarget(book: Audiobook, chapterId?: string) {
  const progress = book.progress?.completed ? null : book.progress;
  const requested = chapterId ?? progress?.chapterId;
  const requestedIndex = book.chapters.findIndex((chapter) => chapter.id === requested);
  if (chapterId !== undefined && requestedIndex === -1) return null;

  const index = Math.max(0, requestedIndex);
  const chapter = book.chapters[index];
  if (!chapter) return null;
  const positionMs = progress && progress.chapterId === chapter.id ? progress.positionMs : 0;
  return { chapter, index, positionMs };
}

export function pausedAudiobookTarget(book: Audiobook) {
  const progress = book.progress;
  if (progress?.completed) {
    const target = audiobookTarget(book, progress.chapterId);
    if (target) return { ...target, positionMs: target.chapter.durationMs };
  }
  return audiobookTarget(book);
}

export function sameAudiobookProgress(a: AudiobookProgress, b: AudiobookProgress) {
  return (
    a.updatedAtMs === b.updatedAtMs &&
    a.chapterId === b.chapterId &&
    a.positionMs === b.positionMs &&
    a.completed === b.completed
  );
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

export interface ProgressEntry {
  progress: AudiobookProgress;
  pending: boolean;
  settled?: AudiobookProgress;
}

export type ProgressJournal = Record<string, ProgressEntry>;

export function journalKey(userId: string) {
  return `caimack-audiobook-progress:${userId}`;
}

function entryKey(userId: string, bookId: string) {
  return `${journalKey(userId)}:${bookId}`;
}

export function isJournalKey(userId: string, key: string | null) {
  return key === journalKey(userId) || Boolean(key?.startsWith(`${journalKey(userId)}:`));
}

export function readProgressJournal(userId: string): ProgressJournal {
  try {
    const prefix = `${journalKey(userId)}:`;
    const legacy = JSON.parse(localStorage.getItem(journalKey(userId)) ?? "{}") as ProgressJournal;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const current = localStorage.getItem(key);
      if (current) legacy[key.slice(prefix.length)] = JSON.parse(current) as ProgressEntry;
    }
    return legacy;
  } catch {
    return {};
  }
}

export function persistProgressEntry(userId: string, bookId: string, entry: ProgressEntry) {
  try {
    localStorage.setItem(entryKey(userId, bookId), JSON.stringify(entry));
  } catch {
    // A browser can disable storage. The active tab can still sync its progress.
  }
}

export function mergeJournalEntry(memory: ProgressEntry | undefined, stored: ProgressEntry) {
  if (!memory) return stored;
  if (stored.settled && sameAudiobookProgress(memory.progress, stored.settled)) return stored;
  if (memory.settled && sameAudiobookProgress(stored.progress, memory.settled)) return memory;
  if (memory.progress.updatedAtMs !== stored.progress.updatedAtMs) {
    return memory.progress.updatedAtMs > stored.progress.updatedAtMs ? memory : stored;
  }
  return !memory.pending && stored.pending ? memory : stored;
}

export function settleProgress(
  current: ProgressEntry | undefined,
  submitted: AudiobookProgress,
  confirmed: AudiobookProgress,
): ProgressEntry {
  if (!current || sameAudiobookProgress(current.progress, submitted)) {
    return { progress: confirmed, pending: false, settled: submitted };
  }
  if (confirmed.updatedAtMs >= current.progress.updatedAtMs) {
    return { progress: confirmed, pending: false, settled: current.progress };
  }
  return current;
}

export function audiobookClockOffset(headers: Headers, sentAt: number, receivedAt: number) {
  const server = Number(headers.get("X-Caimack-Server-Time-Ms"));
  const latency = receivedAt - sentAt;
  if (!Number.isSafeInteger(server) || server <= 0 || latency < 0 || latency > 2_000) return null;
  return Math.round(server - (sentAt + receivedAt) / 2);
}

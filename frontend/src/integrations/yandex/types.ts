// SPDX-License-Identifier: AGPL-3.0-only

export type YandexImportKind = "Likes" | "Album" | "Track" | "Playlist";

export type YandexImportStatus = "Queued" | "Running" | "Finished" | "Failed" | "Cancelled";

export interface YandexImport {
  id: string;
  kind: YandexImportKind;
  title?: string | null;
  status: YandexImportStatus;
  error?: string | null;
  total: number;
  done: number;
  added: number;
  skipped: number;
  playlistId?: string;
  current?: string | null;
  failures: { title: string; reason: string }[];
  createdAt: string;
}

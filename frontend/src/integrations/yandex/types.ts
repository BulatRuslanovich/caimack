// SPDX-License-Identifier: AGPL-3.0-only

export interface YandexTrack {
  id: string;
  title: string;
  artist: string;
  album?: string | null;
  coverUrl?: string | null;
  durationSeconds: number;
  available: boolean;
  inLibrary: boolean;
}

export interface YandexAlbum {
  id: string;
  title: string;
  artist: string;
  year?: number | null;
  trackCount?: number | null;
  coverUrl?: string | null;
}

export interface YandexSearch {
  tracks: YandexTrack[];
  albums: YandexAlbum[];
}

export type YandexImportKind = "Likes" | "Album" | "Track";

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
  current?: string | null;
  failures: { title: string; reason: string }[];
  createdAt: string;
}

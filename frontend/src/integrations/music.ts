// SPDX-License-Identifier: AGPL-3.0-only

import { API_BASE, fetchWithSession, request } from "@/lib/http";
import { requestLocale } from "@/lib/i18n";
import { yandexMusicToken } from "./yandex/yandexMusic";

export interface MusicCandidate {
  source: string;
  id: string;
  artist: string;
  title: string;
  duration: number;
  format?: string | null;
  bitrate?: number | null;
  isrc?: string | null;
  album?: string | null;
  coverUrl?: string | null;
  restricted?: boolean;
}

export interface MusicEvent {
  source: string;
  groups?: MusicCandidate[][];
  albums?: MusicAlbum[];
  error?: string;
}

export interface MusicAlbum {
  url: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  trackCount: number | null;
}

export type MusicSearchKind = "all" | "tracks" | "albums";

export type MusicStatus = "ready" | "needsToken" | "needsBrowser" | "missingExtractor";

export interface MusicSource {
  id: string;
  name: string;
  capabilities: { tracks: boolean; albums: boolean; playlist: boolean; audio: boolean };
  status: MusicStatus;
  audioStatus: MusicStatus;
}

export interface PlaylistSnapshot {
  name: string;
  tracks: MusicCandidate[];
  partial: boolean;
  omitted: number;
}

export interface MusicImport {
  id: string;
  title: string | null;
  state: "queued" | "running" | "waiting" | "finished" | "cancelled";
  error: string | null;
  playlistId: string | null;
  omitted: number;
  partial: boolean;
  total: number;
  done: number;
  failed: number;
}

export interface MusicImportItem {
  position: number;
  track: MusicCandidate;
  state: "queued" | "added" | "reused" | "failed" | "review";
  trackId: string | null;
  error: string | null;
  attempts: { source: string; state: string; error: string | null }[];
  upgrade: MusicCandidate | null;
}

type ImportRequest =
  | { kind: "playlist"; url: string; sources: string[]; allowPartial: boolean; previewId?: string }
  | {
      kind: "track";
      candidate: MusicCandidate;
      automatic: boolean;
      sources: string[];
      searchQuery: string;
    };

function providerHeaders(): Record<string, string> {
  const token = yandexMusicToken();
  return token ? { "x-yandex-music-token": token } : {};
}

export const musicApi = {
  sources: (signal?: AbortSignal) =>
    request<MusicSource[]>("/music/sources", { signal, headers: providerHeaders() }),
  forgetYandex: () =>
    request<MusicSource[]>("/music/sources", { headers: { "x-yandex-music-token": "" } }),
  playlistSource: (url: string, signal?: AbortSignal) =>
    request<MusicSource>("/music/playlist/source", {
      method: "POST",
      body: { url },
      signal,
      headers: providerHeaders(),
    }),
  playlist: (url: string) =>
    request<{ previewId: string; playlist: PlaylistSnapshot }>("/music/playlist", {
      method: "POST",
      body: { url },
      headers: providerHeaders(),
    }),
  start: (body: ImportRequest) =>
    request<{ id: string }>("/music/imports", { method: "POST", body, headers: providerHeaders() }),
  list: (signal?: AbortSignal) =>
    request<MusicImport[]>("/music/imports", { signal, headers: providerHeaders() }),
  items: (id: string, page: number, signal?: AbortSignal) =>
    request<MusicImportItem[]>(`/music/imports/${id}?offset=${page * 100}`, { signal }),
  cancel: (id: string) => request<void>(`/music/imports/${id}`, { method: "DELETE" }),
  retry: (id: string) =>
    request<void>(`/music/imports/${id}/retry`, { method: "POST", headers: providerHeaders() }),
  pick: (id: string, position: number, query: string, candidate: MusicCandidate) =>
    request<void>(`/music/imports/${id}/pick/${position}`, {
      method: "POST",
      body: { query, candidate },
      headers: providerHeaders(),
    }),
  upgrade: (id: string, position: number) =>
    request<void>(`/music/imports/${id}/upgrade/${position}`, {
      method: "POST",
      headers: providerHeaders(),
    }),
};

export async function searchMusic(
  query: string,
  sources: string[],
  signal: AbortSignal,
  onEvent: (event: MusicEvent) => void,
  kind: MusicSearchKind = "all",
) {
  const response = await fetchWithSession(`${API_BASE}/music/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language": requestLocale(),
      ...providerHeaders(),
    },
    body: JSON.stringify({ query, sources, kind }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error("music.searchFailed");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) onEvent(JSON.parse(line) as MusicEvent);
      }
    }
    if (buffer.trim() && !signal.aborted) onEvent(JSON.parse(buffer) as MusicEvent);
  } finally {
    reader.releaseLock();
  }
}

export function isMusicLink(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

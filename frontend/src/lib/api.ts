// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

import { deviceId, flushEvents } from "@/lib/events";
import { fileForm, qs, request, requestFile } from "@/lib/http";
import { markImageChanged } from "@/lib/media";
import type {
  AdminUser,
  Album,
  AlbumDetail,
  Artist,
  ArtistDetail,
  BulkDeleteResult,
  ClientConfig,
  DuplicateReport,
  Genre,
  HistoryEntry,
  HomeFeed,
  HomeMix,
  HomeMixSlug,
  LibraryMap,
  LibraryOverview,
  Lyrics,
  Mood,
  PageParams,
  Paged,
  PlaybackHandoff,
  PlaybackStateReport,
  PlayingElsewhere,
  Playlist,
  PlaylistDetail,
  RadioBatch,
  RecommendationStats,
  Recap,
  SearchResults,
  Track,
  AccountSession,
  CreatedInvitation,
  Invitation,
  LibraryScan,
  SignInRecord,
  RadioFocus,
  TasteRule,
  TasteRuleAction,
  TasteRuleTarget,
  TrackFilter,
  TrackSort,
  UploadProbeFile,
  UploadProbeResult,
  User,
  UserSettings,
  YandexImport,
  YandexImportKind,
  YandexSearch,
} from "@/lib/types";
import { yandexMusicToken } from "@/lib/yandexMusic";

const SECTION_SIZE = 12;
const EVENTS_FLUSH_WAIT_MS = 1500;

export interface SearchTabResult {
  tracks: Paged<Track>;
  albums: Paged<Album>;
  artists: Paged<Artist>;
  genres: Paged<Genre>;
}

export type SearchTab = keyof SearchTabResult;

function yandexHeaders(): Record<string, string> {
  const token = yandexMusicToken();
  return token ? { "X-Yandex-Music-Token": token } : {};
}

async function withImage<T>(upload: Promise<T>, kind: "album" | "artist" | "playlist", id: string) {
  const result = await upload;
  markImageChanged(kind, id, true);
  return result;
}

async function withoutImage(
  remove: Promise<void>,
  kind: "album" | "artist" | "playlist",
  id: string,
) {
  await remove;
  markImageChanged(kind, id, false);
}

export const api = {
  login: (username: string, password: string, deviceName?: string) =>
    request<User>("/auth/login", {
      method: "POST",
      body: { username, password, deviceName },
      sessionless: true,
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<User>("/auth/me", { allowUnauthenticated: true }),
  config: () => request<ClientConfig>("/config"),
  settings: () => request<UserSettings>("/me/settings"),
  updateSettings: (changes: Partial<UserSettings>) =>
    request<UserSettings>("/me/settings", { method: "PUT", body: changes }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/me/password", { method: "POST", body: { currentPassword, newPassword } }),

  homeFeed: async (signal?: AbortSignal) => {
    await flushEvents(EVENTS_FLUSH_WAIT_MS);
    return request<HomeFeed>(`/home/feed${qs({ sectionSize: SECTION_SIZE })}`, { signal });
  },
  homeMix: (kind: HomeMixSlug, signal?: AbortSignal) =>
    request<HomeMix>(`/home/mixes/${kind}`, { signal }),
  libraryOverview: () =>
    request<LibraryOverview>(`/library/overview${qs({ sectionSize: SECTION_SIZE })}`),
  libraryMap: () => request<LibraryMap>("/library/map"),
  duplicates: () => request<DuplicateReport>("/library/duplicates"),
  libraryScan: () => request<LibraryScan>("/library/scan"),
  rescanLibrary: () => request<LibraryScan>("/library/scan", { method: "POST" }),
  dismissDuplicates: (trackIds: string[]) =>
    request<void>("/library/duplicates/dismiss", { method: "POST", body: { trackIds } }),
  mergeDuplicates: (keepId: string, removeIds: string[]) =>
    request<void>("/library/duplicates/merge", { method: "POST", body: { keepId, removeIds } }),
  lookupTracks: (ids: string[]) =>
    request<Track[]>("/tracks/lookup", { method: "POST", body: { ids } }),

  tracks: (
    params: PageParams & TrackFilter & { sort?: TrackSort; q?: string },
    signal?: AbortSignal,
  ) => request<Paged<Track>>(`/tracks${qs(params)}`, { signal }),
  shuffleTracks: (params: { limit?: number; q?: string } = {}) =>
    request<Track[]>(`/tracks/shuffle${qs(params)}`),
  artists: (params: PageParams & { q?: string }, signal?: AbortSignal) =>
    request<Paged<Artist>>(`/artists${qs(params)}`, { signal }),
  artist: (id: string, params: PageParams, signal?: AbortSignal) =>
    request<ArtistDetail>(`/artists/${id}${qs(params)}`, { signal }),
  artistTopTracks: (id: string) =>
    request<Track[]>(`/artists/${id}/top-tracks${qs({ limit: 10 })}`),
  albums: (
    params: PageParams & { artistId?: string; recentFirst?: boolean; q?: string },
    signal?: AbortSignal,
  ) => request<Paged<Album>>(`/albums${qs(params)}`, { signal }),
  album: (id: string, signal?: AbortSignal) => request<AlbumDetail>(`/albums/${id}`, { signal }),
  genres: (signal?: AbortSignal) => request<Genre[]>("/genres", { signal }),
  genreTracks: (id: string, params: PageParams, signal?: AbortSignal) =>
    request<Paged<Track>>(`/genres/${id}/tracks${qs(params)}`, { signal }),
  search: (q: string, limit: number, signal?: AbortSignal) =>
    request<SearchResults>(`/search${qs({ q, limit })}`, { signal }),
  searchTab: <T extends SearchTab>(tab: T, q: string, params: PageParams, signal?: AbortSignal) =>
    request<SearchTabResult[T]>(`/search/${tab}${qs({ q, ...params })}`, { signal }),
  waveform: (trackId: string) => request<{ peaks: number[] }>(`/tracks/${trackId}/waveform`),
  lyrics: (trackId: string) => request<Lyrics | null>(`/tracks/${trackId}/lyrics`),

  updateTrack: (
    id: string,
    changes: {
      title?: string;
      artist?: string;
      album?: string;
      genre?: string;
      year?: number | null;
      trackNumber?: number | null;
      discNumber?: number | null;
    },
  ) => request<Track>(`/tracks/${id}`, { method: "PUT", body: changes }),
  updateLyrics: (trackId: string, text: string) =>
    request<Lyrics | null>(`/tracks/${trackId}/lyrics`, { method: "PUT", body: { text } }),
  deleteTrack: (id: string) => request<void>(`/tracks/${id}`, { method: "DELETE" }),
  deleteTracks: (ids: string[]) =>
    request<BulkDeleteResult>("/tracks/bulk-delete", { method: "POST", body: { ids } }),
  downloadTrack: (id: string, fallbackName: string) =>
    requestFile(`/tracks/${id}/download`, fallbackName),
  checkUpload: (files: UploadProbeFile[]) =>
    request<UploadProbeResult>("/tracks/upload/check", { method: "POST", body: { files } }),
  updateArtist: (id: string, name: string) =>
    request<Artist>(`/artists/${id}`, { method: "PUT", body: { name } }),
  uploadArtistImage: (id: string, file: File) =>
    withImage(
      request<Artist>(`/artists/${id}/image`, { method: "POST", body: fileForm(file) }),
      "artist",
      id,
    ),
  removeArtistImage: (id: string) =>
    withoutImage(request<void>(`/artists/${id}/image`, { method: "DELETE" }), "artist", id),
  updateAlbum: (id: string, changes: { title?: string; artist?: string; year?: number | null }) =>
    request<Album>(`/albums/${id}`, { method: "PUT", body: changes }),
  uploadAlbumCover: (id: string, file: File) =>
    withImage(
      request<Album>(`/albums/${id}/cover`, { method: "POST", body: fileForm(file) }),
      "album",
      id,
    ),
  removeAlbumCover: (id: string) =>
    withoutImage(request<void>(`/albums/${id}/cover`, { method: "DELETE" }), "album", id),

  favorites: (params: PageParams) => request<Paged<Track>>(`/favorites${qs(params)}`),
  addFavorite: (trackId: string) =>
    request<void>(`/tracks/${trackId}/favorite`, { method: "POST" }),
  removeFavorite: (trackId: string) =>
    request<void>(`/tracks/${trackId}/favorite`, { method: "DELETE" }),
  playlists: () => request<Playlist[]>("/playlists"),
  publicPlaylists: () => request<Playlist[]>("/playlists/public"),
  playlist: (id: string) => request<PlaylistDetail>(`/playlists/${id}`),
  createPlaylist: (name: string, description?: string, isPublic = false) =>
    request<Playlist>("/playlists", { method: "POST", body: { name, description, isPublic } }),
  updatePlaylist: (id: string, name: string, description?: string | null, isPublic = false) =>
    request<Playlist>(`/playlists/${id}`, {
      method: "PUT",
      body: { name, description, isPublic },
    }),
  deletePlaylist: (id: string) => request<void>(`/playlists/${id}`, { method: "DELETE" }),
  addToPlaylist: (playlistId: string, trackIds: string[]) =>
    request<void>(`/playlists/${playlistId}/tracks`, { method: "POST", body: { trackIds } }),
  removeFromPlaylist: (playlistId: string, trackId: string) =>
    request<void>(`/playlists/${playlistId}/tracks/${trackId}`, { method: "DELETE" }),
  reorderPlaylist: (playlistId: string, trackIds: string[]) =>
    request<void>(`/playlists/${playlistId}/tracks/order`, { method: "PUT", body: { trackIds } }),
  uploadPlaylistCover: (id: string, file: File) =>
    withImage(
      request<Playlist>(`/playlists/${id}/cover`, { method: "POST", body: fileForm(file) }),
      "playlist",
      id,
    ),
  removePlaylistCover: (id: string) =>
    withoutImage(request<void>(`/playlists/${id}/cover`, { method: "DELETE" }), "playlist", id),

  history: (params: PageParams) => request<Paged<HistoryEntry>>(`/history${qs(params)}`),
  recentlyPlayed: (params: PageParams) => request<Paged<Track>>(`/history/recent${qs(params)}`),
  recordPlay: (trackId: string, playbackPosition: number) =>
    request<void>("/history", { method: "POST", body: { trackId, playbackPosition } }),
  clearHistory: () => request<void>("/history", { method: "DELETE" }),
  reportPlayback: (report: PlaybackStateReport) =>
    request<void>("/playback/state", { method: "PUT", body: report }),
  playingElsewhere: (deviceId: string, signal?: AbortSignal) =>
    request<PlayingElsewhere | undefined>(`/playback/now${qs({ deviceId })}`, { signal }),
  handoff: (deviceId: string) =>
    request<PlaybackHandoff>("/playback/handoff", { method: "POST", body: { deviceId } }),
  radio: async (body: {
    seedTrackId: string | null;
    exclude: string[];
    limit?: number;
    mood?: string | null;
    focus?: RadioFocus | null;
  }) => {
    await flushEvents(EVENTS_FLUSH_WAIT_MS);
    return request<RadioBatch>("/recommendations/radio", {
      method: "POST",
      body: { ...body, sessionId: deviceId() },
    });
  },
  recommendationStats: (days: number) =>
    request<RecommendationStats>(`/recommendations/stats${qs({ days })}`),
  moods: () => request<Mood[]>("/recommendations/moods"),
  tasteRules: () => request<TasteRule[]>("/recommendations/rules"),
  addTasteRule: (body: {
    action: TasteRuleAction;
    targetType: TasteRuleTarget;
    targetId: string;
    days?: number;
  }) => request<TasteRule>("/recommendations/rules", { method: "POST", body }),
  removeTasteRule: (id: string) =>
    request<void>(`/recommendations/rules/${id}`, { method: "DELETE" }),

  recap: async () => (await request<Recap | undefined>("/recap")) ?? null,

  invitation: (token: string) => request<{ expiresAt: string }>(`/auth/invitations/${token}`),
  register: (body: { token: string; username: string; password: string; deviceName?: string }) =>
    request<User>("/auth/register", { method: "POST", body }),
  sessions: () => request<AccountSession[]>("/me/sessions"),
  endSession: (id: string) => request<void>(`/me/sessions/${id}`, { method: "DELETE" }),
  endOtherSessions: () => request<{ ended: number }>("/me/sessions/end-others", { method: "POST" }),
  signIns: () => request<SignInRecord[]>("/me/sign-ins"),
  invitations: () => request<Invitation[]>("/admin/invitations"),
  createInvitation: (body: { isAdmin?: boolean; days?: number }) =>
    request<CreatedInvitation>("/admin/invitations", { method: "POST", body }),
  revokeInvitation: (id: string) => request<void>(`/admin/invitations/${id}`, { method: "DELETE" }),
  adminUsers: (params: PageParams) => request<Paged<AdminUser>>(`/admin/users${qs(params)}`),
  createUser: (body: { username: string; password: string; isAdmin: boolean }) =>
    request<AdminUser>("/admin/users", { method: "POST", body }),
  setUserActive: (id: string, isActive: boolean) =>
    request<AdminUser>(`/admin/users/${id}/active`, { method: "PUT", body: { isActive } }),
  setUserRole: (id: string, isAdmin: boolean) =>
    request<AdminUser>(`/admin/users/${id}/role`, { method: "PUT", body: { isAdmin } }),
  resetUserPassword: (id: string, newPassword: string) =>
    request<void>(`/admin/users/${id}/password`, { method: "POST", body: { newPassword } }),
  revokeUserSessions: (id: string) =>
    request<void>(`/admin/users/${id}/sessions/revoke`, { method: "POST" }),

  yandexSearch: (q: string, signal?: AbortSignal) =>
    request<YandexSearch>(`/integrations/yandex-music/search${qs({ q })}`, {
      signal,
      headers: yandexHeaders(),
    }),
  yandexImports: () => request<YandexImport[]>("/integrations/yandex-music/imports"),
  startYandexImport: (kind: YandexImportKind, id?: string) =>
    request<YandexImport>("/integrations/yandex-music/imports", {
      method: "POST",
      body: { kind, id },
      headers: yandexHeaders(),
    }),
  removeYandexImport: (id: string) =>
    request<void>(`/integrations/yandex-music/imports/${id}`, { method: "DELETE" }),
};

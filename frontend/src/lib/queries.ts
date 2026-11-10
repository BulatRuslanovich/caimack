// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { api, type SearchTab } from "@/lib/api";
import { ApiError } from "@/lib/http";
import { CARD_PAGE_SIZE, TRACK_PAGE_SIZE } from "@/lib/pageSizes";
import type {
  ArtistDetail,
  HomeMixSlug,
  PageParams,
  Paged,
  Track,
  TrackFilter,
  TrackSort,
} from "@/lib/types";
import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  type PlaceholderDataFunction,
  type QueryClient,
} from "@tanstack/react-query";

function keepPreviousOf<TData>(id: string | null): PlaceholderDataFunction<TData> {
  return (previous, query) => (query?.queryKey[1] === id ? previous : undefined);
}

export const SEARCH_MIN_LENGTH = 3;

export const queries = {
  config: () =>
    queryOptions({ queryKey: ["config"], queryFn: () => api.config(), staleTime: Infinity }),

  settings: () =>
    queryOptions({
      queryKey: ["settings"],
      queryFn: () => api.settings(),
    }),

  sessions: () => queryOptions({ queryKey: ["sessions"], queryFn: () => api.sessions() }),
  signIns: () => queryOptions({ queryKey: ["signIns"], queryFn: () => api.signIns() }),
  invitations: () => queryOptions({ queryKey: ["invitations"], queryFn: () => api.invitations() }),

  tasteRules: () => queryOptions({ queryKey: ["tasteRules"], queryFn: () => api.tasteRules() }),

  recommendationStats: (days: number) =>
    queryOptions({
      queryKey: ["recommendationStats", days],
      queryFn: () => api.recommendationStats(days),
      placeholderData: keepPreviousData,
    }),

  recap: () =>
    queryOptions({
      queryKey: ["recap"],
      queryFn: () => api.recap(),
      retry: false,
      staleTime: 3_600_000,
    }),

  homeFeed: () =>
    queryOptions({ queryKey: ["homeFeed"], queryFn: ({ signal }) => api.homeFeed(signal) }),

  waveform: (trackId: string) =>
    queryOptions({
      queryKey: ["waveform", trackId],
      queryFn: async () => {
        try {
          return (await api.waveform(trackId)).peaks;
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }
      },
      staleTime: Infinity,
      retry: false,
    }),

  lyrics: (trackId: string) =>
    queryOptions({
      queryKey: ["lyrics", trackId],
      queryFn: async () => (await api.lyrics(trackId)) ?? null,
      staleTime: Infinity,
    }),

  homeMix: (kind: HomeMixSlug) =>
    queryOptions({
      queryKey: ["homeMix", kind],
      queryFn: ({ signal }) => api.homeMix(kind, signal),
    }),

  tracks: (params: PageParams & TrackFilter & { sort?: TrackSort; q?: string }) =>
    queryOptions({
      queryKey: ["tracks", params],
      queryFn: ({ signal }) => api.tracks(params, signal),
      placeholderData: keepPreviousData,
    }),

  albums: (params: PageParams & { artistId?: string; recentFirst?: boolean; q?: string }) =>
    queryOptions({
      queryKey: ["albums", params],
      queryFn: ({ signal }) => api.albums(params, signal),
      placeholderData: keepPreviousData,
    }),

  album: (id: string) =>
    queryOptions({ queryKey: ["album", id], queryFn: ({ signal }) => api.album(id, signal) }),

  albumsFeed: ({ recentFirst = false, q }: { recentFirst?: boolean; q?: string } = {}) =>
    infiniteQueryOptions({
      queryKey: ["albums", "feed", { recentFirst, q }],
      queryFn: ({ pageParam, signal }) =>
        api.albums({ page: pageParam, pageSize: CARD_PAGE_SIZE, recentFirst, q }, signal),
      initialPageParam: 1,
      getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    }),

  artistsFeed: ({ q }: { q?: string } = {}) =>
    infiniteQueryOptions({
      queryKey: ["artists", "feed", { q }],
      queryFn: ({ pageParam, signal }) =>
        api.artists({ page: pageParam, pageSize: CARD_PAGE_SIZE, q }, signal),
      initialPageParam: 1,
      getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    }),

  artist: (id: string, page = 1) =>
    queryOptions({
      queryKey: ["artist", id, page],
      queryFn: ({ signal }) => api.artist(id, { page, pageSize: TRACK_PAGE_SIZE }, signal),
      placeholderData: keepPreviousOf<ArtistDetail>(id),
    }),

  artistTopTracks: (id: string) =>
    queryOptions({ queryKey: ["artist", id, "top"], queryFn: () => api.artistTopTracks(id) }),

  genres: () => queryOptions({ queryKey: ["genres"], queryFn: ({ signal }) => api.genres(signal) }),

  genreTracks: (id: string | null, params: PageParams) =>
    queryOptions({
      queryKey: ["genreTracks", id, params],
      queryFn: ({ signal }) => api.genreTracks(id!, params, signal),
      enabled: id !== null,
      placeholderData: keepPreviousOf<Paged<Track>>(id),
    }),

  search: (q: string) =>
    queryOptions({
      queryKey: ["search", q],
      queryFn: ({ signal }) => api.search(q, 25, signal),
      enabled: q.length >= SEARCH_MIN_LENGTH,
      placeholderData: keepPreviousData,
    }),

  searchTab: <T extends SearchTab>(tab: T, q: string, params: PageParams) =>
    queryOptions({
      queryKey: ["search", tab, q, params],
      queryFn: ({ signal }) => api.searchTab(tab, q, params, signal),
      enabled: q.length >= SEARCH_MIN_LENGTH,
      placeholderData: (previous, query) => (query?.queryKey[1] === tab ? previous : undefined),
    }),

  favorites: (params: PageParams) =>
    queryOptions({
      queryKey: ["favorites", params],
      queryFn: () => api.favorites(params),
      placeholderData: keepPreviousData,
    }),

  playlists: () => queryOptions({ queryKey: ["playlists"], queryFn: () => api.playlists() }),

  libraryOverview: () =>
    queryOptions({ queryKey: ["libraryOverview"], queryFn: () => api.libraryOverview() }),

  libraryMap: () =>
    queryOptions({
      queryKey: ["libraryMap"],
      queryFn: () => api.libraryMap(),
      staleTime: 300_000,
      refetchInterval: (query) => (query.state.data?.points.length === 0 ? 15_000 : false),
    }),

  duplicates: () => queryOptions({ queryKey: ["duplicates"], queryFn: () => api.duplicates() }),

  libraryScan: () =>
    queryOptions({
      queryKey: ["libraryScan"],
      queryFn: () => api.libraryScan(),
      refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
    }),

  publicPlaylists: () =>
    queryOptions({ queryKey: ["playlists", "public"], queryFn: () => api.publicPlaylists() }),

  playlist: (id: string) =>
    queryOptions({ queryKey: ["playlist", id], queryFn: () => api.playlist(id) }),

  recentlyPlayed: (params: PageParams) =>
    queryOptions({
      queryKey: ["history", "recent", params],
      queryFn: () => api.recentlyPlayed(params),
      placeholderData: keepPreviousData,
    }),

  history: (params: PageParams) =>
    queryOptions({
      queryKey: ["history", "log", params],
      queryFn: () => api.history(params),
      placeholderData: keepPreviousData,
    }),

  adminUsers: (params: PageParams) =>
    queryOptions({
      queryKey: ["adminUsers", params],
      queryFn: () => api.adminUsers(params),
      placeholderData: keepPreviousData,
    }),

  yandexSearch: (q: string) =>
    queryOptions({
      queryKey: ["yandexSearch", q],
      queryFn: ({ signal }) => api.yandexSearch(q, signal),
      enabled: q.length >= SEARCH_MIN_LENGTH,
      staleTime: 60_000,
    }),

  yandexImports: () =>
    queryOptions({
      queryKey: ["yandexImports"],
      queryFn: () => api.yandexImports(),
      refetchInterval: (query) =>
        query.state.data?.some((job) => job.status === "Queued" || job.status === "Running")
          ? 2000
          : false,
    }),
};

export const navigationPrefetch: Record<string, (client: QueryClient) => Promise<void>> = {
  "/": (client) => client.prefetchQuery(queries.homeFeed()),
  "/tracks": (client) =>
    client.prefetchQuery(
      queries.tracks({ page: 1, pageSize: TRACK_PAGE_SIZE, sort: "Title", q: undefined }),
    ),
  "/albums": (client) => client.prefetchInfiniteQuery(queries.albumsFeed()),
  "/artists": (client) => client.prefetchInfiniteQuery(queries.artistsFeed()),
  "/genres": (client) => client.prefetchQuery(queries.genres()),
  "/favorites": (client) =>
    client.prefetchQuery(queries.favorites({ page: 1, pageSize: TRACK_PAGE_SIZE })),
  "/recently-played": (client) =>
    client.prefetchQuery(queries.recentlyPlayed({ page: 1, pageSize: TRACK_PAGE_SIZE })),
  "/playlists": async (client) => {
    await Promise.all([
      client.prefetchQuery(queries.playlists()),
      client.prefetchQuery(queries.libraryOverview()),
    ]);
  },
};

export const invalidates = {
  library: [
    ["tracks"],
    ["albums"],
    ["album"],
    ["artists"],
    ["artist"],
    ["genres"],
    ["search"],
    ["homeFeed"],
    ["homeMix"],
    ["libraryOverview"],
    ["libraryMap"],
    ["duplicates"],
  ],
  playlists: [["playlists"], ["playlist"], ["homeFeed"]],
  favorites: [["favorites"], ["tracks"], ["homeFeed"], ["homeMix"], ["libraryOverview"]],
  history: [["history"], ["homeFeed"], ["homeMix"]],
  recommendations: [["tasteRules"], ["homeFeed"], ["homeMix"]],
} as const;

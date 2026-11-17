// SPDX-License-Identifier: AGPL-3.0-only

import {
  InfiniteQueryObserver,
  QueryClient,
  QueryObserver,
  type QueryKey,
} from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { ApiError } from "./http";
import { WAVEFORM_VERSION } from "./waveform";
import { invalidates, navigationPrefetch, queries } from "./queries";
import { CARD_PAGE_SIZE } from "./pageSizes";
import type { Album, LibraryMap, Paged } from "./types";

describe("library navigation cache", () => {
  it("warms the saved library and reuses that data when returning to Saved", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 300_000 } } });
    const saved = vi.spyOn(api, "savedLibrary").mockResolvedValue([]);
    const folders = vi.spyOn(api, "libraryFolders").mockResolvedValue([]);
    const order = vi.spyOn(api, "libraryOrder").mockResolvedValue({});
    const favorites = vi
      .spyOn(api, "favorites")
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 1, totalPages: 0 });
    try {
      await navigationPrefetch["/library"](client);
      await Promise.all([
        client.fetchQuery(queries.savedLibrary()),
        client.fetchQuery(queries.libraryFolders()),
        client.fetchQuery(queries.libraryOrder()),
        client.fetchQuery(queries.favorites({ page: 1, pageSize: 1 })),
      ]);
      for (const request of [saved, folders, order, favorites])
        expect(request).toHaveBeenCalledOnce();
    } finally {
      vi.restoreAllMocks();
      client.clear();
    }
  });

  it("keeps loaded album pages while fetching page one of a new filter", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 300_000 } } });
    const cached = {
      pages: [{ items: [], total: 120, page: 2, pageSize: CARD_PAGE_SIZE, totalPages: 2 }],
      pageParams: [2],
    };
    client.setQueryData(queries.albumsFeed().queryKey, cached);
    let complete!: (page: Paged<Album>) => void;
    const request = vi.spyOn(api, "albums").mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const observer = new InfiniteQueryObserver(client, queries.albumsFeed());
    const unsubscribe = observer.subscribe(() => {});
    try {
      observer.setOptions(queries.albumsFeed({ q: "new" }));
      expect(observer.getCurrentResult().isPlaceholderData).toBe(true);
      expect(observer.getCurrentResult().data).toBe(cached);
      expect(request).toHaveBeenCalledWith(
        { page: 1, pageSize: CARD_PAGE_SIZE, recentFirst: false, q: "new" },
        expect.any(AbortSignal),
      );
      complete({ items: [], total: 0, page: 1, pageSize: CARD_PAGE_SIZE, totalPages: 0 });
      await vi.waitFor(() => expect(observer.getCurrentResult().isPlaceholderData).toBe(false));
      expect(observer.getCurrentResult().data?.pageParams).toEqual([1]);
    } finally {
      unsubscribe();
      request.mockRestore();
      client.clear();
    }
  });
});

describe("waveform analysis upgrades", () => {
  it.each(["not ready", "obsolete"])(
    "refetches a %s waveform instead of caching it forever",
    async (state) => {
      const client = new QueryClient();
      const request = vi.spyOn(api, "waveform");
      if (state === "not ready") request.mockRejectedValueOnce(new ApiError(404, "Not ready"));
      else request.mockResolvedValueOnce({ peaks: [255, 255, 255], version: WAVEFORM_VERSION - 1 });
      request.mockResolvedValue({ peaks: [20, 120, 240], version: WAVEFORM_VERSION });
      try {
        const options = queries.waveform("track");
        expect(await client.fetchQuery(options)).toBeNull();
        expect(await client.fetchQuery(options)).toEqual([20, 120, 240]);
        expect(await client.fetchQuery(options)).toEqual([20, 120, 240]);
        expect(request).toHaveBeenCalledTimes(2);
      } finally {
        request.mockRestore();
        client.clear();
      }
    },
  );
});

describe("library map refresh", () => {
  it.each([
    { count: 0, total: 40, updating: false, interval: 15_000 },
    { count: 36, total: 40, updating: true, interval: 15_000 },
    { count: 36, total: 40, updating: false, interval: 60_000 },
    { count: 40, total: 40, updating: false, interval: false },
  ])(
    "refreshes $count/$total tracks with updating=$updating",
    ({ count, total, updating, interval }) => {
      const client = new QueryClient();
      const options = queries.libraryMap();
      client.setQueryData(options.queryKey, {
        points: Array.from({ length: count }, (_, i) => ({
          id: String(i),
          x: 0.5,
          y: 0.5,
          title: "Song",
          artist: "Artist",
          hasCover: false,
          plays: 0,
        })),
        totalTracks: total,
        updating,
      } satisfies LibraryMap);
      const query = new QueryObserver(client, options).getCurrentQuery();
      expect(typeof options.refetchInterval).toBe("function");
      if (typeof options.refetchInterval === "function") {
        expect(options.refetchInterval(query)).toBe(interval);
      }
      client.clear();
    },
  );
});

describe("favorite cache invalidation", () => {
  it("marks every cached track view stale, including inactive pages", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    const keys: QueryKey[] = [
      queries.favorites({ page: 1 }).queryKey,
      queries.tracks({ page: 1 }).queryKey,
      queries.album("album").queryKey,
      queries.artist("artist", 2).queryKey,
      queries.artistTopTracks("artist").queryKey,
      queries.playlist("playlist").queryKey,
      queries.genreTracks("genre", { page: 1 }).queryKey,
      queries.search("song").queryKey,
      queries.searchTab("tracks", "song", { page: 1 }).queryKey,
      queries.history({ page: 1 }).queryKey,
      queries.recentlyPlayed({ page: 1 }).queryKey,
      queries.duplicates().queryKey,
      queries.recap().queryKey,
      queries.homeFeed().queryKey,
      queries.homeMix("daily").queryKey,
      queries.libraryOverview().queryKey,
    ];
    for (const key of keys) client.setQueryData(key, {});
    client.setQueryData(queries.settings().queryKey, { quality: "Normal", timeZone: "UTC" });

    await Promise.all(
      invalidates.favorites.map((queryKey) => client.invalidateQueries({ queryKey })),
    );

    for (const key of keys)
      expect(client.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    expect(client.getQueryState(queries.settings().queryKey)?.isInvalidated).toBe(false);
    client.clear();
  });
});

// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { ApiError } from "./http";
import { WAVEFORM_VERSION } from "./waveform";
import { invalidates, queries } from "./queries";

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

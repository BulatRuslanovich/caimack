// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { invalidates, queries } from "./queries";

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

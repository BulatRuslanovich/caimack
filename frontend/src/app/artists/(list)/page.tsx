// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { HydrationBoundary } from "@tanstack/react-query";
import { ArtistsPage } from "@/app/artists/(list)/ArtistsPage";
import { queries } from "@/lib/queries";
import { prefetchOnServer } from "@/lib/server/prefetch";

export default async function Page() {
  const state = await prefetchOnServer((client) =>
    Promise.all([
      client.prefetchInfiniteQuery(queries.artistsFeed()),
      client.prefetchQuery(queries.libraryOverview()),
    ]),
  );

  return (
    <HydrationBoundary state={state}>
      <ArtistsPage />
    </HydrationBoundary>
  );
}

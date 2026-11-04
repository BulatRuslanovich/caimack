// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { HydrationBoundary } from "@tanstack/react-query";
import { RecentlyPlayedPage } from "@/app/recently-played/RecentlyPlayedPage";
import { TRACK_PAGE_SIZE } from "@/lib/pageSizes";
import { queries } from "@/lib/queries";
import { prefetchOnServer } from "@/lib/server/prefetch";

export default async function Page() {
  const state = await prefetchOnServer((client) =>
    Promise.all([
      client.prefetchQuery(queries.recentlyPlayed({ page: 1, pageSize: TRACK_PAGE_SIZE })),
      client.prefetchQuery(queries.history({ page: 1, pageSize: TRACK_PAGE_SIZE })),
    ]),
  );

  return (
    <HydrationBoundary state={state}>
      <RecentlyPlayedPage />
    </HydrationBoundary>
  );
}

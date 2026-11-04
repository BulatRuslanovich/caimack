// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { HydrationBoundary } from "@tanstack/react-query";
import { TracksPage } from "@/app/tracks/TracksPage";
import { TRACK_PAGE_SIZE } from "@/lib/pageSizes";
import { queries } from "@/lib/queries";
import { prefetchOnServer } from "@/lib/server/prefetch";

export default async function Page() {
  const state = await prefetchOnServer((client) =>
    Promise.all([
      client.prefetchQuery(queries.tracks({ page: 1, pageSize: TRACK_PAGE_SIZE, sort: "Title" })),
      client.prefetchQuery(queries.libraryOverview()),
    ]),
  );

  return (
    <HydrationBoundary state={state}>
      <TracksPage />
    </HydrationBoundary>
  );
}

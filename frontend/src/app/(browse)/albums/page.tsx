// SPDX-License-Identifier: AGPL-3.0-only

import { HydrationBoundary } from "@tanstack/react-query";
import { AlbumsPage } from "@/app/albums/(list)/AlbumsPage";
import { queries } from "@/lib/queries";
import { prefetchOnServer } from "@/lib/server/prefetch";

export default async function Page() {
  const state = await prefetchOnServer(
    (client) =>
      Promise.all([
        client.prefetchInfiniteQuery(queries.albumsFeed()),
        client.prefetchQuery(queries.libraryOverview()),
      ]),
    { initialOnly: true },
  );

  return (
    <HydrationBoundary state={state}>
      <AlbumsPage />
    </HydrationBoundary>
  );
}

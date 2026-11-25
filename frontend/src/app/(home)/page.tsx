// SPDX-License-Identifier: AGPL-3.0-only

import { HydrationBoundary } from "@tanstack/react-query";
import { HomePage } from "@/components/home/HomePage";
import { queries } from "@/lib/queries";
import { prefetchInitialPage as prefetchOnServer } from "@/lib/server/prefetch";

export default async function Page() {
  const state = await prefetchOnServer((client) =>
    Promise.all([
      client.prefetchQuery(queries.homeFeed()),
      client.prefetchQuery(queries.searchPopular()),
    ]),
  );

  return (
    <HydrationBoundary state={state}>
      <HomePage />
    </HydrationBoundary>
  );
}

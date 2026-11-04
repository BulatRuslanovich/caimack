// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { HydrationBoundary } from "@tanstack/react-query";
import { HomePage } from "@/components/home/HomePage";
import { queries } from "@/lib/queries";
import { prefetchOnServer } from "@/lib/server/prefetch";

export default async function Page() {
  const state = await prefetchOnServer((client) => client.prefetchQuery(queries.homeFeed()));

  return (
    <HydrationBoundary state={state}>
      <HomePage />
    </HydrationBoundary>
  );
}

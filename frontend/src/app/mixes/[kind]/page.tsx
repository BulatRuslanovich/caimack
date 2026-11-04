// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { HydrationBoundary } from "@tanstack/react-query";
import { MixPage } from "@/app/mixes/[kind]/MixPage";
import { isMixSlug } from "@/lib/mixes";
import { queries } from "@/lib/queries";
import { prefetchOnServer } from "@/lib/server/prefetch";

export default async function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;

  const state = isMixSlug(kind)
    ? await prefetchOnServer((client) => client.prefetchQuery(queries.homeMix(kind)))
    : undefined;

  return (
    <HydrationBoundary state={state}>
      <MixPage />
    </HydrationBoundary>
  );
}

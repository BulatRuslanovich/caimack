// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { HydrationBoundary } from "@tanstack/react-query";
import { PlaylistPage } from "@/app/playlists/[id]/PlaylistPage";
import { queries } from "@/lib/queries";
import { prefetchOnServer } from "@/lib/server/prefetch";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const state = await prefetchOnServer((client) => client.prefetchQuery(queries.playlist(id)));

  return (
    <HydrationBoundary state={state}>
      <PlaylistPage />
    </HydrationBoundary>
  );
}

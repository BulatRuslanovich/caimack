// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { UsersRoundIcon } from "lucide-react";
import { queries } from "@/lib/queries";
import { ArtistCard } from "@/components/MediaCard";
import { CardGrid, CardGridSkeleton, PageHeader, Section } from "@/components/PageHeader";
import { Shelf } from "@/components/Shelf";
import { InfiniteQuery } from "@/components/InfiniteQuery";
import { useT } from "@/contexts/I18nContext";

export function ArtistsPage({ query }: { query: string }) {
  const t = useT();

  const artists = useInfiniteQuery(queries.artistsFeed({ q: query || undefined }));

  const overview = useQuery({ ...queries.libraryOverview(), enabled: !query });
  const recent = overview.data?.recentArtists ?? [];

  const total = artists.data?.pages[0]?.total ?? 0;
  const showShelf = !query && recent.length > 0 && total > recent.length;

  return (
    <div className="flex min-w-0 flex-col gap-6 max-md:gap-5">
      <PageHeader subtitle={artists.data ? t("count.artists", { count: total }) : undefined} />

      {showShelf && (
        <Shelf title={t("library.recentlyAdded")}>
          {recent.map((artist) => (
            <ArtistCard key={artist.id} artist={artist} bare />
          ))}
        </Shelf>
      )}

      <InfiniteQuery
        result={artists}
        skeleton={<CardGridSkeleton round />}
        empty={{
          icon: <UsersRoundIcon size={24} />,
          title: query ? t("filter.nothingMatched") : t("artists.empty"),
        }}
      >
        {(items) => (
          <Section title={showShelf ? t("library.allArtists") : undefined}>
            <CardGrid>
              {items.map((artist) => (
                <ArtistCard key={artist.id} artist={artist} bare />
              ))}
            </CardGrid>
          </Section>
        )}
      </InfiniteQuery>
    </div>
  );
}

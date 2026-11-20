// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Disc3Icon } from "lucide-react";
import { useState } from "react";
import { queries } from "@/lib/queries";
import { AlbumCard } from "@/components/MediaCard";
import { CardGrid, CardGridSkeleton, Section } from "@/components/PageHeader";
import { CatalogToolbar } from "@/app/search/CatalogToolbar";
import { Shelf } from "@/components/Shelf";
import { SortSelect } from "@/components/PageToolbar";
import { InfiniteQuery } from "@/components/InfiniteQuery";
import { useT } from "@/contexts/I18nContext";

const sortKeys = { title: "sort.title", recent: "sort.dateAdded" } as const;

type Sort = keyof typeof sortKeys;

export function AlbumsPage({ query }: { query: string }) {
  const t = useT();

  const [sort, setSort] = useState<Sort>("title");

  const albums = useInfiniteQuery(
    queries.albumsFeed({
      recentFirst: sort === "recent",
      q: query || undefined,
    }),
  );

  const alphabetical = !query && sort === "title";
  const overview = useQuery({ ...queries.libraryOverview(), enabled: alphabetical });
  const recent = overview.data?.recentAlbums ?? [];

  const total = albums.data?.pages[0]?.total ?? 0;
  const showShelf = alphabetical && recent.length > 0 && total > recent.length;

  return (
    <div className="flex min-w-0 flex-col gap-3 [overflow-anchor:none]">
      <CatalogToolbar
        summary={albums.data ? t("count.albums", { count: total }) : undefined}
        actions={<SortSelect value={sort} onChange={setSort} options={sortKeys} />}
      />

      {showShelf && (
        <Shelf title={t("library.recentlyAdded")} className="gap-2.5">
          {recent.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </Shelf>
      )}

      <InfiniteQuery
        result={albums}
        skeleton={<CardGridSkeleton />}
        empty={{
          icon: <Disc3Icon size={24} />,
          title: query ? t("filter.nothingMatched") : t("albums.empty"),
        }}
      >
        {(items) => (
          <Section title={showShelf ? t("library.allAlbums") : undefined} className="gap-2.5">
            <CardGrid>
              {items.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </CardGrid>
          </Section>
        )}
      </InfiniteQuery>
    </div>
  );
}

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Disc3Icon } from "lucide-react";
import { useState } from "react";
import { queries } from "@/lib/queries";
import { AlbumCard } from "@/components/MediaCard";
import { CardGrid, CardGridSkeleton, PageHeader, Section } from "@/components/PageHeader";
import { Shelf } from "@/components/Shelf";
import { PageToolbar, SortSelect } from "@/components/PageToolbar";
import { InfiniteQuery } from "@/components/InfiniteQuery";
import { useT } from "@/contexts/I18nContext";

const sortKeys = { title: "sort.title", recent: "sort.dateAdded" } as const;

type Sort = keyof typeof sortKeys;

export function AlbumsPage() {
  const t = useT();

  const [sort, setSort] = useState<Sort>("title");
  const [search, setSearch] = useState("");

  const albums = useInfiniteQuery(
    queries.albumsFeed({
      recentFirst: sort === "recent",
      q: search || undefined,
    }),
  );

  const alphabetical = !search && sort === "title";
  const overview = useQuery({ ...queries.libraryOverview(), enabled: alphabetical });
  const recent = overview.data?.recentAlbums ?? [];

  const total = albums.data?.pages[0]?.total ?? 0;
  const showShelf = alphabetical && recent.length > 0 && total > recent.length;

  return (
    <div className="flex min-w-0 flex-col gap-8 [overflow-anchor:none] max-md:gap-6">
      <PageHeader
        title={t("nav.albums")}
        subtitle={albums.data ? t("count.albums", { count: total }) : undefined}
      />

      <PageToolbar search={search} onSearch={setSearch} placeholder={t("filter.albums")}>
        <SortSelect value={sort} onChange={setSort} options={sortKeys} />
      </PageToolbar>

      {showShelf && (
        <Shelf title={t("library.recentlyAdded")}>
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
          title: search ? t("filter.nothingMatched") : t("albums.empty"),
        }}
      >
        {(items) => (
          <Section title={showShelf ? t("library.allAlbums") : undefined}>
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

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Disc3Icon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { readStored, writeStored } from "@/lib/storage";
import { queries } from "@/lib/queries";
import { AlbumCard } from "@/components/MediaCard";
import { CardGrid, CardGridSkeleton, PageHeader, Section } from "@/components/PageHeader";
import { Shelf } from "@/components/Shelf";
import { PageToolbar, SortSelect } from "@/components/PageToolbar";
import { InfiniteQuery } from "@/components/InfiniteQuery";
import { RecordCrate } from "@/components/crate/RecordCrate";
import { useT } from "@/contexts/I18nContext";

const sortKeys = { title: "sort.title", recent: "sort.dateAdded" } as const;

type Sort = keyof typeof sortKeys;

type View = "grid" | "crate";

const VIEW_KEY = "music-streaming.albums-view";

const viewListeners = new Set<() => void>();

function useAlbumsView(): [View, (next: View) => void] {
  const view = useSyncExternalStore<View>(
    (listener) => {
      viewListeners.add(listener);
      return () => viewListeners.delete(listener);
    },
    () => (readStored(VIEW_KEY) === "crate" ? "crate" : "grid"),
    () => "grid",
  );

  const setView = (next: View) => {
    writeStored(VIEW_KEY, next);
    for (const listener of viewListeners) listener();
  };

  return [view, setView];
}

export function AlbumsPage() {
  const t = useT();

  const [sort, setSort] = useState<Sort>("title");
  const [search, setSearch] = useState("");
  const [view, setView] = useAlbumsView();

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
  const showShelf = view === "grid" && alphabetical && recent.length > 0 && total > recent.length;

  return (
    <div className="flex min-w-0 flex-col gap-8 [overflow-anchor:none] max-md:gap-6">
      <PageHeader
        title={t("nav.albums")}
        subtitle={albums.data ? t("count.albums", { count: total }) : undefined}
      />

      <PageToolbar
        search={search}
        onSearch={setSearch}
        placeholder={t("filter.albums")}
        layout={{ value: view, onChange: setView }}
      >
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
        {(items) =>
          view === "crate" ? (
            <RecordCrate
              key={`${sort}:${search}`}
              albums={items}
              total={total}
              hasMore={albums.hasNextPage}
              onNeedMore={() => {
                if (!albums.isFetchingNextPage) void albums.fetchNextPage();
              }}
            />
          ) : (
            <Section title={showShelf ? t("library.allAlbums") : undefined}>
              <CardGrid>
                {items.map((album) => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </CardGrid>
            </Section>
          )
        }
      </InfiniteQuery>
    </div>
  );
}

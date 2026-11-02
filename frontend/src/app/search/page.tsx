// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { cn } from "@/lib/cn";
import type { Route } from "next";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, type ReactNode } from "react";
import type { SearchTab, SearchTabResult } from "@/lib/api";
import { queries, SEARCH_MIN_LENGTH } from "@/lib/queries";
import { rememberSearch } from "@/lib/recentSearches";
import { usePage } from "@/lib/usePage";
import { AlbumCard, ArtistCard } from "@/components/MediaCard";
import { CardGrid, PageHeader, Section } from "@/components/PageHeader";
import { Pagination, PageToolbar } from "@/components/PageToolbar";
import { Query } from "@/components/Query";
import { TrackList } from "@/components/TrackList";
import { SearchIcon } from "lucide-react";
import { hiddenScrollbar } from "@/components/Shelf";
import { ToggleGroup, ToggleGroupButton } from "@/components/ui/toggle-group";
import { useT } from "@/contexts/I18nContext";
import { useYandexMusicSettings } from "@/lib/useYandexMusic";
import { useAuth } from "@/contexts/AuthContext";
import { YandexSearchWorkspace } from "@/components/yandex/YandexSearchWorkspace";
import { YandexActivityButton } from "@/components/yandex/YandexImports";
import { GenreChips } from "./GenreChips";
import { RecentSearches } from "./RecentSearches";
import { TopResult } from "./TopResult";

const PAGE_SIZE = 50;

const PREVIEW = 5;

const START_GENRES = 24;

const TABS: SearchTab[] = ["tracks", "albums", "artists", "genres"];

const YANDEX_TAB = "yandex";

type Tab = SearchTab | typeof YANDEX_TAB;

const previewRow = cn(
  "grid grid-cols-5 gap-5 max-xl:gap-4",
  "max-md:-mx-4 max-md:grid-flow-col max-md:grid-cols-none max-md:auto-cols-[7.5rem] max-md:gap-3 max-md:overflow-x-auto max-md:px-4",
  hiddenScrollbar,
);

const TAB_LABELS = {
  tracks: "nav.tracks",
  albums: "nav.albums",
  artists: "nav.artists",
  genres: "nav.genres",
} as const;

export default function SearchPage() {
  const t = useT();

  return (
    <Suspense fallback={<PageHeader title={t("nav.search")} />}>
      <SearchView />
    </Suspense>
  );
}

function isTab(value: string | null): value is SearchTab {
  return value !== null && (TABS as string[]).includes(value);
}

function SearchView() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();

  const { isAdmin } = useAuth();
  const yandexSettings = useYandexMusicSettings();
  const yandex = isAdmin && yandexSettings.enabled;

  const query = (params.get("q") ?? "").trim();
  const tabParam = params.get("tab");
  const yandexTab = yandex && tabParam === YANDEX_TAB;
  const tab = isTab(tabParam) ? tabParam : null;

  const navigate = useCallback(
    (next: string, nextTab: Tab | null) => {
      if (!next) {
        router.replace(nextTab === YANDEX_TAB ? "/search?tab=yandex" : "/search");
        return;
      }

      const search = new URLSearchParams({ q: next });
      if (nextTab) search.set("tab", nextTab);

      router.replace(`/search?${search}`);
    },
    [router],
  );

  const results = useQuery({
    ...queries.search(query),
    enabled: !yandexTab && query.length >= SEARCH_MIN_LENGTH,
  });

  const previewTracks = useMemo(() => results.data?.tracks.slice(0, PREVIEW) ?? [], [results.data]);

  return (
    <>
      <PageHeader title={t("nav.search")} actions={yandex && <YandexActivityButton />} />

      {yandex && (
        <ToggleGroup aria-label={t("search.source")}>
          <ToggleGroupButton active={!yandexTab} onClick={() => navigate(query, null)}>
            {t("search.source.library")}
          </ToggleGroupButton>
          <ToggleGroupButton active={yandexTab} onClick={() => navigate(query, YANDEX_TAB)}>
            {t("yandex.title")}
          </ToggleGroupButton>
        </ToggleGroup>
      )}

      <PageToolbar
        search={query}
        onSearch={(next) => navigate(next, yandexTab ? YANDEX_TAB : tab)}
        placeholder={t(yandexTab ? "yandex.searchPlaceholder" : "search.placeholder")}
        autoFocus
      />

      {query.length < SEARCH_MIN_LENGTH && !yandexTab ? (
        <SearchStart />
      ) : (
        <>
          {!yandexTab && (
            <ToggleGroup aria-label={t("search.tabs")}>
              <ToggleGroupButton
                active={tab === null && !yandexTab}
                onClick={() => navigate(query, null)}
              >
                {t("search.tab.all")}
              </ToggleGroupButton>
              {TABS.map((value) => (
                <ToggleGroupButton
                  key={value}
                  active={tab === value}
                  onClick={() => navigate(query, value)}
                >
                  {t(TAB_LABELS[value])}
                </ToggleGroupButton>
              ))}
            </ToggleGroup>
          )}

          <div
            className="contents"
            onClickCapture={(event) => {
              if ((event.target as Element).closest("a, button")) rememberSearch(query);
            }}
          >
            {yandexTab ? (
              <YandexSearchWorkspace query={query} />
            ) : tab === null ? (
              <Query
                result={results}
                isEmpty={(data) =>
                  data.artists.length === 0 &&
                  data.albums.length === 0 &&
                  data.tracks.length === 0 &&
                  data.genres.length === 0
                }
                empty={{ icon: <SearchIcon size={24} />, title: t("search.nothingFound") }}
              >
                {(data) => (
                  <>
                    <div
                      data-beside={data.top && data.tracks.length > 0 ? "" : undefined}
                      className="group/top grid gap-x-8 gap-y-11 max-md:gap-y-8 lg:data-beside:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]"
                    >
                      {data.top && <TopResult top={data.top} />}

                      {data.tracks.length > 0 && (
                        <Section
                          title={t("nav.tracks")}
                          href={seeAll(query, "tracks", data.tracks.length)}
                        >
                          <TrackList tracks={previewTracks} showAlbum={!data.top} />
                        </Section>
                      )}
                    </div>

                    {data.albums.length > 0 && (
                      <Section
                        title={t("nav.albums")}
                        href={seeAll(query, "albums", data.albums.length)}
                      >
                        <div className={previewRow}>
                          {data.albums.slice(0, PREVIEW).map((album) => (
                            <AlbumCard key={album.id} album={album} />
                          ))}
                        </div>
                      </Section>
                    )}

                    {data.artists.length > 0 && (
                      <Section
                        title={t("nav.artists")}
                        href={seeAll(query, "artists", data.artists.length)}
                      >
                        <div className={previewRow}>
                          {data.artists.slice(0, PREVIEW).map((artist) => (
                            <ArtistCard key={artist.id} artist={artist} />
                          ))}
                        </div>
                      </Section>
                    )}

                    {data.genres.length > 0 && (
                      <Section
                        title={t("nav.genres")}
                        href={seeAll(query, "genres", data.genres.length)}
                      >
                        <GenreChips genres={data.genres.slice(0, PREVIEW * 2)} />
                      </Section>
                    )}
                  </>
                )}
              </Query>
            ) : (
              <TabResults tab={tab} query={query} />
            )}
          </div>
        </>
      )}
    </>
  );
}

function seeAll(query: string, tab: SearchTab, shown: number): Route | undefined {
  return shown > PREVIEW ? `/search?q=${encodeURIComponent(query)}&tab=${tab}` : undefined;
}

const tabItems: { [T in SearchTab]: (items: SearchTabResult[T]["items"]) => ReactNode } = {
  tracks: (tracks) => <TrackList tracks={tracks} />,
  albums: (albums) => (
    <CardGrid>
      {albums.map((album) => (
        <AlbumCard key={album.id} album={album} />
      ))}
    </CardGrid>
  ),
  artists: (artists) => (
    <CardGrid>
      {artists.map((artist) => (
        <ArtistCard key={artist.id} artist={artist} />
      ))}
    </CardGrid>
  ),
  genres: (genres) => <GenreChips genres={genres} />,
};

function TabResults<T extends SearchTab>({ tab, query }: { tab: T; query: string }) {
  const t = useT();
  const [page, setPage] = usePage([tab, query]);
  const result = useQuery(queries.searchTab(tab, query, { page, pageSize: PAGE_SIZE }));

  return (
    <Query
      result={result}
      empty={{ icon: <SearchIcon size={24} />, title: t("search.nothingFound") }}
    >
      {(data) => (
        <>
          {tabItems[tab](data.items)}
          <Pagination result={data} onChange={setPage} />
        </>
      )}
    </Query>
  );
}

function SearchStart() {
  const t = useT();
  const genres = useQuery(queries.genres());

  const top = useMemo(
    () =>
      [...(genres.data ?? [])].sort((a, b) => b.trackCount - a.trackCount).slice(0, START_GENRES),
    [genres.data],
  );

  return (
    <>
      <RecentSearches />

      {genres.isPending ? null : top.length === 0 ? null : (
        <Section title={t("search.browseGenres")} href="/genres">
          <GenreChips genres={top} />
        </Section>
      )}
    </>
  );
}

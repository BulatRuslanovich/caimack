// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { cn } from "@/lib/cn";
import type { Route } from "next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Activity, Suspense, useMemo, useState } from "react";
import { prefetchSearchCategory, queries, SEARCH_MIN_LENGTH } from "@/lib/queries";
import { rememberSearch } from "@/lib/recentSearches";
import { isCatalogTab, type CatalogTab } from "@/lib/searchNavigation";
import { AlbumCard, ArtistCard } from "@/components/MediaCard";
import { PageHeader, Section } from "@/components/PageHeader";
import { AudiobookRow } from "@/components/audiobooks/AudiobookViews";
import { SearchField } from "@/components/SearchField";
import { Query } from "@/components/Query";
import { TrackList } from "@/components/TrackList";
import { SearchIcon } from "lucide-react";
import { hiddenScrollbar, Shelf } from "@/components/Shelf";
import { RankedList } from "@/components/collection/RankedList";
import { ToggleGroup, ToggleGroupButton } from "@/components/ui/toggle-group";
import { useT } from "@/contexts/I18nContext";
import { useYandexMusicSettings } from "@/lib/useYandexMusic";
import { useAuth } from "@/contexts/AuthContext";
import { useAudiobooks } from "@/contexts/AudiobookContext";
import { filterAudiobooks, type Audiobook } from "@/lib/audiobooks";
import { YandexSearchWorkspace } from "@/components/yandex/YandexSearchWorkspace";
import { YandexActivityButton } from "@/components/yandex/YandexImports";
import { TracksPage } from "@/app/tracks/TracksPage";
import { AlbumsPage } from "@/app/albums/(list)/AlbumsPage";
import { ArtistsPage } from "@/app/artists/(list)/ArtistsPage";
import { PlaylistsPage } from "@/app/playlists/(list)/PlaylistsPage";
import { GenresPage } from "@/app/genres/GenresPage";
import { GenreCategories, GenreChips } from "./GenreChips";
import { RecentSearches } from "./RecentSearches";
import { SearchTabs } from "./SearchTabs";
import { TopResult } from "./TopResult";

const PREVIEW = 5;

const START_GENRES = 8;

const YANDEX_TAB = "yandex";

type Tab = CatalogTab | typeof YANDEX_TAB;

const previewRow = cn(
  "grid grid-cols-5 gap-3",
  "max-md:grid-flow-col max-md:grid-cols-none max-md:auto-cols-[7.5rem] max-md:overflow-x-auto",
  hiddenScrollbar,
);

export default function SearchPage() {
  const t = useT();

  return (
    <Suspense fallback={<PageHeader title={t("nav.search")} />}>
      <SearchView />
    </Suspense>
  );
}

function SearchView() {
  const t = useT();
  const params = useSearchParams();
  const client = useQueryClient();

  const { isAdmin } = useAuth();
  const { books, result: audiobookCatalog } = useAudiobooks();
  const yandexSettings = useYandexMusicSettings();
  const yandex = isAdmin && yandexSettings.enabled;

  const query = (params.get("q") ?? "").trim();
  const tabParam = params.get("tab");
  const yandexTab = yandex && tabParam === YANDEX_TAB;
  const tab = isCatalogTab(tabParam) ? tabParam : null;
  const [visited, setVisited] = useState<CatalogTab[]>([]);
  if (tab && tab !== "audiobooks" && !visited.includes(tab)) setVisited([...visited, tab]);

  const navigate = (next: string, nextTab: Tab | null, push = false, genreId?: string | null) => {
    const search = new URLSearchParams();
    if (next) search.set("q", next);
    if (nextTab) search.set("tab", nextTab);
    if (genreId) search.set("id", genreId);
    const href = search.size ? `/search?${search}` : "/search";
    if (href !== window.location.pathname + window.location.search) {
      window.history[push ? "pushState" : "replaceState"](null, "", href);
    }
  };

  const results = useQuery({
    ...queries.search(query),
    enabled: !yandexTab && tab === null && query.length >= SEARCH_MIN_LENGTH,
  });

  const previewTracks = useMemo(() => results.data?.tracks.slice(0, PREVIEW) ?? [], [results.data]);
  const bookMatches = useMemo(() => filterAudiobooks(books, query), [books, query]);
  const searchPlaceholder = yandexTab
    ? "yandex.searchPlaceholder"
    : tab === "audiobooks"
      ? "search.audiobookPlaceholder"
      : "search.placeholder";

  return (
    <div className="search-page flex min-w-0 flex-col gap-3">
      <div className="search-controls flex min-w-0 flex-col gap-3 [&>header]:items-center">
        <PageHeader title={t("nav.search")} actions={yandex && <YandexActivityButton />} />

        {yandex && (
          <ToggleGroup aria-label={t("search.source")}>
            <ToggleGroupButton
              active={!yandexTab}
              onClick={() => yandexTab && navigate(query, null, true)}
            >
              {t("search.source.library")}
            </ToggleGroupButton>
            <ToggleGroupButton
              active={yandexTab}
              onClick={() => !yandexTab && navigate(query, YANDEX_TAB, true)}
            >
              {t("yandex.title")}
            </ToggleGroupButton>
          </ToggleGroup>
        )}

        <SearchField
          value={query}
          onChange={(next) => navigate(next, yandexTab ? YANDEX_TAB : tab)}
          placeholder={t(searchPlaceholder)}
          autoFocus
        />
      </div>

      {!yandexTab && (
        <SearchTabs
          tab={tab}
          onSelect={(value) => tab !== value && navigate(query, value, true)}
          onIntent={(value) => {
            if (tab !== value) void prefetchSearchCategory(client, value, query || undefined);
          }}
        />
      )}

      <div
        className="contents"
        onClickCapture={(event) => {
          if (query.length >= SEARCH_MIN_LENGTH && (event.target as Element).closest("a, button")) {
            rememberSearch(query);
          }
        }}
      >
        {yandexTab && <YandexSearchWorkspace query={query} />}
        {!yandexTab &&
          tab === null &&
          (query.length < SEARCH_MIN_LENGTH ? (
            <SearchStart showPopular={query === ""} />
          ) : (
            <Query
              result={results}
              isEmpty={(data) =>
                bookMatches.length === 0 &&
                !audiobookCatalog.isPending &&
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
                    className="grid min-w-0 items-start gap-3 lg:data-beside:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]"
                  >
                    {data.top && <TopResult top={data.top} />}

                    {data.tracks.length > 0 && (
                      <Section
                        title={t("nav.tracks")}
                        href={seeAll(query, "tracks", data.tracks.length)}
                        className="min-w-0 gap-2.5"
                      >
                        <TrackList tracks={previewTracks} showAlbum={!data.top} />
                      </Section>
                    )}
                  </div>

                  {data.albums.length > 0 && (
                    <Section
                      title={t("nav.albums")}
                      href={seeAll(query, "albums", data.albums.length)}
                      className="gap-2.5"
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
                      className="gap-2.5"
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
                      className="gap-2.5"
                    >
                      <GenreChips genres={data.genres.slice(0, PREVIEW * 2)} />
                    </Section>
                  )}
                </>
              )}
            </Query>
          ))}
        {!yandexTab &&
          tab === null &&
          query.length >= SEARCH_MIN_LENGTH &&
          bookMatches.length > 0 && (
            <Section
              title={t("nav.audiobooks")}
              href={seeAll(query, "audiobooks", bookMatches.length)}
            >
              <AudiobookMatches books={bookMatches.slice(0, PREVIEW)} />
            </Section>
          )}
        {!yandexTab &&
          tab === "audiobooks" &&
          (bookMatches.length > 0 ? (
            <AudiobookMatches books={bookMatches} />
          ) : (
            <Query
              result={audiobookCatalog}
              isEmpty={() => true}
              empty={{
                icon: <SearchIcon size={24} />,
                title: t(query ? "search.nothingFound" : "audiobooks.empty"),
              }}
            >
              {() => null}
            </Query>
          ))}
        {visited.map((category) => (
          <Activity key={category} mode={tab === category && !yandexTab ? "visible" : "hidden"}>
            {category === "tracks" && <TracksPage query={query} />}
            {category === "albums" && <AlbumsPage query={query} />}
            {category === "artists" && <ArtistsPage query={query} />}
            {category === "playlists" && <PlaylistsPage query={query} />}
            {category === "genres" && (
              <GenresPage
                query={query}
                selected={tab === "genres" ? params.get("id") : null}
                onSelect={(id) => navigate(query, "genres", true, id)}
              />
            )}
          </Activity>
        ))}
      </div>
    </div>
  );
}

function AudiobookMatches({ books }: { books: Audiobook[] }) {
  return (
    <ul className="min-w-0 divide-y divide-border">
      {books.map((book) => (
        <AudiobookRow key={book.id} book={book} />
      ))}
    </ul>
  );
}

function seeAll(query: string, tab: CatalogTab, shown: number): Route | undefined {
  return shown > PREVIEW ? `/search?q=${encodeURIComponent(query)}&tab=${tab}` : undefined;
}

function SearchStart({ showPopular }: { showPopular: boolean }) {
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

      <Query
        result={genres}
        empty={{ title: t("search.browseEmpty"), description: t("search.browseEmptyHint") }}
      >
        {() => (
          <Section title={t("search.browseGenres")} className="gap-2.5">
            <GenreCategories genres={top} />
          </Section>
        )}
      </Query>

      {showPopular && <PopularSearch />}
    </>
  );
}

function PopularSearch() {
  const t = useT();
  const result = useQuery(queries.searchPopular());

  return (
    <Query result={result}>
      {({ tracks, albums, artists }) => (
        <>
          {tracks.length > 0 && (
            <Section title={t("search.mostPlayedTracks")}>
              <RankedList tracks={tracks} ranked={false} density="compact" />
            </Section>
          )}
          {albums.length > 0 && (
            <Shelf title={t("search.mostPlayedAlbums")} className="gap-2.5">
              {albums.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </Shelf>
          )}
          {artists.length > 0 && (
            <Shelf title={t("search.mostPlayedArtists")} className="gap-2.5">
              {artists.map((artist) => (
                <ArtistCard key={artist.id} artist={artist} bare />
              ))}
            </Shelf>
          )}
        </>
      )}
    </Query>
  );
}

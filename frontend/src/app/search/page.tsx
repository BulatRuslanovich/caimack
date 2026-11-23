// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { cn } from "@/lib/cn";
import type { Route } from "next";
import Link from "next/link";
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
import { hiddenScrollbar } from "@/components/Shelf";
import { useAuth } from "@/contexts/AuthContext";
import { isMusicLink } from "@/integrations/music";
import {
  useExternalMusicSearch,
  useMusicDefaults,
  useMusicSources,
  usePlaylistLinkImport,
} from "@/integrations/useMusicSources";
import { MusicSourceFilter } from "./MusicSourceFilter";
import { MusicSearch } from "./MusicSearch";
import { useT } from "@/contexts/I18nContext";
import { useAudiobooks } from "@/contexts/AudiobookContext";
import { filterAudiobooks, type Audiobook } from "@/lib/audiobooks";
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

  const { enabled: audiobooksEnabled, books, result: audiobookCatalog } = useAudiobooks();
  const { isAdmin } = useAuth();
  const externalSearch = useExternalMusicSearch();
  const linkImport = usePlaylistLinkImport();
  const disabledSources = useMusicDefaults();
  const [filters, setFilters] = useState<Record<string, boolean>>({});

  const query = (params.get("q") ?? "").trim();
  const [draft, setDraft] = useState({ query, value: query });
  if (draft.query !== query) setDraft({ query, value: query });
  const tabParam = params.get("tab");
  const tab =
    isCatalogTab(tabParam) && (tabParam !== "audiobooks" || audiobooksEnabled) ? tabParam : null;
  const musicLink = isAdmin && isMusicLink(query);
  const playlistLink = musicLink && linkImport === true;
  const musicWorkspace =
    isAdmin && (musicLink || tab === null || tab === "tracks" || tab === "albums");
  const searchEnabled = musicWorkspace && externalSearch && !musicLink;
  const unified = playlistLink || searchEnabled;
  const { sources, catalog, vk } = useMusicSources(unified);
  const searchable = sources.filter(({ capabilities }) =>
    tab === "albums" && !playlistLink
      ? capabilities.albums
      : tab === "tracks" || playlistLink
        ? capabilities.tracks
        : capabilities.tracks || capabilities.albums,
  );
  const enabled = (id: string) => filters[id] ?? !disabledSources.includes(id);
  const selected = searchable.filter(({ id, status }) => status === "ready" && enabled(id));
  const [visited, setVisited] = useState<CatalogTab[]>([]);
  if (tab && tab !== "audiobooks" && !visited.includes(tab)) setVisited([...visited, tab]);

  const navigate = (
    next: string,
    nextTab: string | null,
    push = false,
    genreId?: string | null,
  ) => {
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
    enabled: tab === null && !musicLink && query.length >= SEARCH_MIN_LENGTH,
  });

  const previewTracks = useMemo(() => results.data?.tracks.slice(0, PREVIEW) ?? [], [results.data]);
  const onlyTrack = previewTracks.length === 1 ? previewTracks[0] : undefined;
  const topMatch = results.data?.top;
  const topResult =
    onlyTrack && topMatch?.kind === "Track" && topMatch.track?.id === onlyTrack.id
      ? null
      : topMatch;
  const bookMatches = filterAudiobooks(books, query);
  const searchPlaceholder =
    tab === "audiobooks"
      ? "search.audiobookPlaceholder"
      : musicWorkspace && linkImport === true
        ? "music.placeholder"
        : audiobooksEnabled
          ? "search.placeholderWithAudiobooks"
          : "search.placeholder";

  return (
    <div className="search-page flex min-w-0 flex-col gap-3">
      <div className="search-controls flex min-w-0 flex-col gap-3 [&>header]:items-center">
        <PageHeader title={t("nav.search")} />

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <SearchField
            value={query}
            onChange={(next) => navigate(next, tab)}
            onDraftChange={(value) => setDraft({ query, value })}
            placeholder={t(searchPlaceholder)}
            className="basis-64 grow"
            autoFocus
          />
          {unified && (
            <MusicSourceFilter
              sources={searchable}
              vkStatus={vk}
              enabled={enabled}
              count={selected.length}
              loading={catalog.isPending}
              failed={catalog.isError}
              onToggle={(id) => setFilters((current) => ({ ...current, [id]: !enabled(id) }))}
            />
          )}
        </div>
      </div>

      {!musicLink && (
        <SearchTabs
          tab={tab}
          audiobooksEnabled={audiobooksEnabled}
          onSelect={(value) => tab !== value && navigate(query, value, true)}
          onIntent={(value) => {
            if (tab !== value) void prefetchSearchCategory(client, value, query || undefined);
          }}
        />
      )}

      {musicLink && linkImport === false && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("music.linkImportDisabled")}{" "}
          <Link href="/settings?tab=music" className="font-medium text-primary hover:underline">
            {t("music.sourceSettings")}
          </Link>
        </p>
      )}

      <div
        className="contents"
        onClickCapture={(event) => {
          if (query.length >= SEARCH_MIN_LENGTH && (event.target as Element).closest("a, button")) {
            rememberSearch(query);
          }
        }}
      >
        {!musicLink &&
          tab === null &&
          (query.length < SEARCH_MIN_LENGTH ? (
            <SearchStart />
          ) : (
            <Query
              result={results}
              isEmpty={(data) =>
                bookMatches.length === 0 &&
                (!audiobooksEnabled || !audiobookCatalog.isPending) &&
                data.artists.length === 0 &&
                data.albums.length === 0 &&
                data.tracks.length === 0 &&
                data.genres.length === 0
              }
              empty={
                unified
                  ? undefined
                  : {
                      icon: <SearchIcon size={24} />,
                      title: t("search.nothingFound"),
                    }
              }
            >
              {(data) =>
                unified &&
                !topResult &&
                !data.tracks.length &&
                !data.albums.length &&
                !data.artists.length &&
                !data.genres.length &&
                !bookMatches.length ? (
                  <p className="py-2 text-sm text-muted-foreground">{t("music.noLocalTracks")}</p>
                ) : (
                  <>
                    <div
                      data-beside={topResult && data.tracks.length > 0 ? "" : undefined}
                      className="grid min-w-0 gap-x-6 gap-y-4 lg:data-beside:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
                    >
                      {topResult && (
                        <TopResult top={topResult} compactTrack={data.tracks.length === 1} />
                      )}

                      {data.tracks.length > 0 && (
                        <Section
                          title={t("nav.tracks")}
                          href={seeAll(query, "tracks", data.tracks.length)}
                          className="min-w-0 gap-2.5"
                        >
                          <TrackList tracks={previewTracks} showAlbum={!topResult} />
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
                )
              }
            </Query>
          ))}
        {!musicLink &&
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
        {!musicLink &&
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
          <Activity key={category} mode={tab === category && !musicLink ? "visible" : "hidden"}>
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
        {musicWorkspace && (!musicLink || playlistLink) && (
          <MusicSearch
            query={query}
            searchEnabled={searchEnabled}
            linkImportEnabled={linkImport === true}
            selection={selected.map(({ id }) => id)}
            sources={sources}
            kind={tab === "albums" ? "albums" : tab === "tracks" ? "tracks" : "all"}
            link={playlistLink}
            linkPending={playlistLink && draft.query === query && draft.value.trim() !== query}
            onQuery={(next) => navigate(next, null)}
          />
        )}
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
    </>
  );
}

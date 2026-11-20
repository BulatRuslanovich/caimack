// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { queries } from "@/lib/queries";
import type { Album, Artist, Track } from "@/lib/types";
import SearchPage from "./page";

const route = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(route.search) }));
vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/lib/useYandexMusic", () => ({ useYandexMusicSettings: () => ({ enabled: false }) }));
vi.mock("./RecentSearches", () => ({ RecentSearches: () => <p>recent searches</p> }));
vi.mock("@/components/collection/RankedList", () => ({
  RankedList: ({
    tracks,
    ranked,
    density,
  }: {
    tracks: Track[];
    ranked: boolean;
    density: string;
  }) => (
    <ol data-density={density} data-ranked={ranked}>
      {tracks.map((track) => (
        <li key={track.id}>{track.title}</li>
      ))}
    </ol>
  ),
}));
vi.mock("@/components/MediaCard", () => ({
  AlbumCard: ({ album }: { album: Album }) => <p>{album.title}</p>,
  ArtistCard: ({ artist, bare }: { artist: Artist; bare: boolean }) => (
    <p data-bare={bare}>{artist.name}</p>
  ),
}));
vi.mock("@/app/tracks/TracksPage", () => ({
  TracksPage: ({ query }: { query: string }) => <p data-tracks-query={query} />,
}));
vi.mock("@/app/playlists/(list)/PlaylistsPage", () => ({
  PlaylistsPage: ({ query }: { query: string }) => <p data-playlists-query={query} />,
}));
vi.mock("@/app/genres/GenresPage", () => ({
  GenresPage: ({ selected }: { selected: string }) => <p data-selected-genre={selected} />,
}));

function render(search: string) {
  route.search = search;
  const client = new QueryClient();
  const metadata = {
    artistId: "artist-0",
    artistName: "Artist 0",
    createdAt: "2026-01-01T00:00:00Z",
    durationSeconds: 180,
    hasCover: false,
  };
  client.setQueryData(queries.searchPopular().queryKey, {
    tracks: Array.from({ length: 10 }, (_, index) => ({
      ...metadata,
      id: `track-${index}`,
      title: `Track ${index}`,
      originalFileName: `track-${index}.mp3`,
      isFavorite: false,
      hasLyrics: false,
    })),
    albums: Array.from({ length: 5 }, (_, index) => ({
      ...metadata,
      id: `album-${index}`,
      title: `Album ${index}`,
      trackCount: 2,
    })),
    artists: Array.from({ length: 5 }, (_, index) => ({
      id: `artist-${index}`,
      name: `Artist ${index}`,
      trackCount: 2,
      albumCount: 1,
      hasImage: false,
    })),
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SearchPage />
    </QueryClientProvider>,
  );
}

it("shows all catalog tabs on the search start screen", () => {
  const markup = render("");
  for (const tab of ["tracks", "albums", "artists", "playlists", "genres"]) {
    expect(markup).toContain(`>nav.${tab}</button>`);
  }
  expect(markup).toContain("recent searches");
  expect(markup).not.toContain('data-tracks-query=""');
});

it("shows popular tracks, albums and artists in order on the empty All tab", () => {
  const markup = render("");
  expect(markup).toMatch(
    /recent searches.*search.mostPlayedTracks.*search.mostPlayedAlbums.*search.mostPlayedArtists/,
  );
  expect(markup).toContain('data-density="compact" data-ranked="false"');
  expect(markup.match(/<li>Track \d+<\/li>/g)).toHaveLength(10);
  expect(markup.match(/<p>Album \d+<\/p>/g)).toHaveLength(5);
  expect(markup.match(/<p data-bare="true">Artist \d+<\/p>/g)).toHaveLength(5);
  expect(render("q=ab")).not.toContain("search.mostPlayedTracks");
  expect(render("q=abc")).not.toContain("search.mostPlayedTracks");
  expect(render("tab=tracks")).toContain('data-tracks-query=""');
  expect(render("tab=tracks")).not.toContain("search.mostPlayedTracks");
});

it("opens the selected catalog category with or without a query", () => {
  expect(render("tab=playlists")).toContain('data-playlists-query=""');
  expect(render("tab=playlists&q=road%20trip")).toContain('data-playlists-query="road trip"');
  expect(render("tab=genres&id=rock")).toContain('data-selected-genre="rock"');
});

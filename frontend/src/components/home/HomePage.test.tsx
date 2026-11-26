// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { queries } from "@/lib/queries";
import type { Audiobook } from "@/lib/audiobooks";
import type { Album, Artist, HomeBlock, Track } from "@/lib/types";
import { HomePage } from "./HomePage";

const catalog = vi.hoisted(() => ({ books: [] as Audiobook[] }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));
vi.mock("@/contexts/AudiobookContext", () => ({
  useAudiobooks: () => ({
    books: catalog.books,
    downloaded: new Set(),
    online: true,
    player: { active: null },
  }),
}));
vi.mock("@/lib/useFormat", () => ({ useFormat: () => ({ totalDuration: () => "" }) }));
vi.mock("@/lib/useShelfImpression", () => ({ useShelfImpression: () => null }));
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
vi.mock("@/components/PageHeader", () => ({
  SectionHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
  Section: ({ title, href, children }: { title: string; href?: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {href && <a href={href}>See all</a>}
      {children}
    </section>
  ),
}));
vi.mock("./RadioHero", () => ({ RadioHero: () => null }));
vi.mock("./RecapBanner", () => ({ RecapBanner: () => null }));

function book(id: string, updatedAtMs?: number, completed = false): Audiobook {
  return {
    id,
    title: id,
    author: null,
    narrator: null,
    coverUrl: null,
    durationMs: 2000,
    chapters: [],
    saved: false,
    progress:
      updatedAtMs === undefined
        ? null
        : {
            chapterId: "chapter",
            positionMs: 1000,
            updatedAtMs,
            completed,
          },
  };
}

const block = (baseKey: string): HomeBlock => ({
  key: baseKey,
  baseKey,
  zone: "Browse",
  layout: "Grid",
});

function render(blocks: HomeBlock[], books: Audiobook[]) {
  catalog.books = books;
  const client = new QueryClient();
  client.setQueryData(queries.homeFeed().queryKey, {
    blocks,
    stats: {
      trackCount: 0,
      albumCount: 0,
      totalDurationSeconds: 0,
      totalBytes: 0,
      freeBytes: 0,
      favoriteCount: 0,
    },
  });
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
      <HomePage />
    </QueryClientProvider>,
  );
}

it("shows only the most recent unfinished audiobook immediately after fresh arrivals", () => {
  const newAlbums: HomeBlock = {
    ...block("newAlbums"),
    layout: "Shelf",
    albums: [
      {
        id: "new-album",
        title: "Separate new album",
        artistId: "artist",
        artistName: "Artist",
        trackCount: 1,
        durationSeconds: 180,
        hasCover: false,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
  };
  const html = render(
    [newAlbums, block("newArrivals"), block("topTracks")],
    [
      book("previous-book", 2),
      book("last-book", 3),
      book("finished-book", 4, true),
      book("unplayed-book"),
    ],
  );
  expect(html).toMatch(
    /home\.newArrivals.*audiobooks\.continueAtHome.*href="\/audiobooks\/last-book".*search\.mostPlayedTracks/,
  );
  expect(html).not.toContain("Separate new album");
  expect(html).toContain('href="/mixes/new"');
  expect(html.match(/href="\/audiobooks\//g)).toHaveLength(1);
});

it("keeps the last audiobook available without a music feed and hides the card without listening history", () => {
  expect(render([], [book("last-book", 3)])).toContain('href="/audiobooks/last-book"');
  expect(render([block("newArrivals")], [book("unplayed-book")])).not.toContain(
    'href="/audiobooks/',
  );
});

it("replaces the weekly chart with popular tracks, albums and artists", () => {
  const markup = render([block("topTracks"), block("newArrivals")], []);
  expect(markup).toMatch(
    /search.mostPlayedTracks.*search.mostPlayedAlbums.*search.mostPlayedArtists.*home.newArrivals/,
  );
  expect(markup).not.toContain("home.topThisWeek");
  expect(markup).toContain('data-density="compact" data-ranked="false"');
  expect(markup.match(/<li>Track \d+<\/li>/g)).toHaveLength(10);
  expect(markup.match(/<p>Album \d+<\/p>/g)).toHaveLength(5);
  expect(markup.match(/<p data-bare="true">Artist \d+<\/p>/g)).toHaveLength(5);
  expect(render([block("newArrivals")], [])).toContain("search.mostPlayedTracks");
});

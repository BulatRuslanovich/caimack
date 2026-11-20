// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { queries } from "@/lib/queries";
import type { Audiobook } from "@/lib/audiobooks";
import type { HomeBlock } from "@/lib/types";
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
vi.mock("@/components/collection/RankedList", () => ({ RankedList: () => null }));
vi.mock("@/components/PageHeader", () => ({
  Section: ({ title, children }: { title: string; children: ReactNode }) => (
    <section>
      <h2>{title}</h2>
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
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <HomePage />
    </QueryClientProvider>,
  );
}

it("shows only the most recent unfinished audiobook immediately after fresh arrivals", () => {
  const html = render(
    [block("newAlbums"), block("newArrivals"), block("topTracks")],
    [
      book("previous-book", 2),
      book("last-book", 3),
      book("finished-book", 4, true),
      book("unplayed-book"),
    ],
  );
  expect(html).toMatch(
    /home\.newArrivals.*audiobooks\.continue.*href="\/audiobooks\/last-book".*home\.topThisWeek/,
  );
  expect(html.match(/href="\/audiobooks\//g)).toHaveLength(1);
});

it("keeps the last audiobook available without a music feed and hides the card without listening history", () => {
  expect(render([], [book("last-book", 3)])).toContain('href="/audiobooks/last-book"');
  expect(render([block("newArrivals")], [book("unplayed-book")])).not.toContain(
    'href="/audiobooks/',
  );
});

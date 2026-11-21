// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import SearchPage from "./page";

const route = vi.hoisted(() => ({ search: "", audiobooksEnabled: true }));
const books = vi.hoisted(() => [
  {
    id: "quantum",
    title: "Квантовый кот вселенной",
    author: "Эрвин Шрёдингер",
    narrator: "Егор Бедуля",
  },
  {
    id: "chance",
    title: "(Не)совершенная случайность",
    author: "Леонард Млодинов",
    narrator: "Михаил Росляков",
  },
]);
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(route.search) }));
vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/contexts/AudiobookContext", () => ({
  useAudiobooks: () => ({
    enabled: route.audiobooksEnabled,
    books: route.audiobooksEnabled ? books : [],
    result: { data: books, isPending: false },
  }),
}));
vi.mock("@/components/audiobooks/AudiobookViews", () => ({
  AudiobookRow: ({ book }: { book: (typeof books)[number] }) => <li>{book.title}</li>,
}));
vi.mock("@/lib/useYandexMusic", () => ({ useYandexMusicSettings: () => ({ enabled: false }) }));
vi.mock("./RecentSearches", () => ({ RecentSearches: () => <p>recent searches</p> }));
vi.mock("@/app/tracks/TracksPage", () => ({
  TracksPage: ({ query }: { query: string }) => <p data-tracks-query={query} />,
}));
vi.mock("@/app/playlists/(list)/PlaylistsPage", () => ({
  PlaylistsPage: ({ query }: { query: string }) => <p data-playlists-query={query} />,
}));
vi.mock("@/app/genres/GenresPage", () => ({
  GenresPage: ({ selected }: { selected: string }) => <p data-selected-genre={selected} />,
}));

function render(search: string, audiobooksEnabled = true) {
  route.search = search;
  route.audiobooksEnabled = audiobooksEnabled;
  const client = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <SearchPage />
    </QueryClientProvider>,
  );
}

it("shows all catalog tabs on the search start screen", () => {
  const markup = render("");
  for (const tab of ["tracks", "audiobooks", "albums", "artists", "playlists", "genres"]) {
    expect(markup).toContain(`>nav.${tab}</button>`);
  }
  expect(markup).toContain("recent searches");
  expect(markup).not.toContain('data-tracks-query=""');
});

it("hides the audiobook search filter while its experiment is disabled", () => {
  const markup = render("tab=audiobooks&q=Hawking", false);
  expect(markup).not.toContain(">nav.audiobooks</button>");
  expect(markup).not.toContain("search.audiobookPlaceholder");
});

it("opens the selected catalog category with or without a query", () => {
  expect(render("tab=playlists")).toContain('data-playlists-query=""');
  expect(render("tab=playlists&q=road%20trip")).toContain('data-playlists-query="road trip"');
  expect(render("tab=genres&id=rock")).toContain('data-selected-genre="rock"');
});

it("finds audiobooks by title, author and narrator from the filter and All", () => {
  expect(render("tab=audiobooks")).toContain("Квантовый кот вселенной");
  const query = encodeURIComponent("квант ШРЕДИНГЕР бедуля");
  const filtered = render(`tab=audiobooks&q=${query}`);
  expect(filtered).toContain("Квантовый кот вселенной");
  expect(filtered).not.toContain("(Не)совершенная случайность");
  expect(render(`q=${query}`)).toContain("Квантовый кот вселенной");
  expect(render("tab=audiobooks&q=nonexistent")).toContain("search.nothingFound");
});

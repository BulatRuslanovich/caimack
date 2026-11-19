// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import SearchPage from "./page";

const route = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(route.search) }));
vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: false }) }));
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

function render(search: string) {
  route.search = search;
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
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
  expect(markup).toContain("search.allTracks");
  expect(markup).toContain('data-tracks-query=""');
  expect(render("q=ab")).not.toContain("search.allTracks");
});

it("opens the selected catalog category with or without a query", () => {
  expect(render("tab=playlists")).toContain('data-playlists-query=""');
  expect(render("tab=playlists&q=road%20trip")).toContain('data-playlists-query="road trip"');
  expect(render("tab=genres&id=rock")).toContain('data-selected-genre="rock"');
});

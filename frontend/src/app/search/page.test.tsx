// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { queries } from "@/lib/queries";
import type { SearchResults, SearchTopResult, Track } from "@/lib/types";
import SearchPage from "./page";

const route = vi.hoisted(() => ({
  search: "",
  audiobooksEnabled: true,
  providerEnabled: false,
}));
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
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(route.search),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));
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
vi.mock("@/integrations/registry", () => ({
  useEnabledIntegrations: () =>
    route.providerEnabled
      ? [
          {
            id: "provider",
            search: {
              label: "Provider",
              Workspace: ({ query }: { query: string }) => <p data-provider-query={query} />,
            },
          },
        ]
      : [],
}));
vi.mock("./RecentSearches", () => ({ RecentSearches: () => <p>recent searches</p> }));
vi.mock("./TopResult", () => ({
  TopResult: ({ top }: { top: SearchTopResult }) => <p data-top-result>{top.track?.title}</p>,
}));
vi.mock("@/components/TrackList", () => ({
  TrackList: ({ tracks }: { tracks: Track[] }) => (
    <ul>
      {tracks.map((track) => (
        <li key={track.id}>{track.title}</li>
      ))}
    </ul>
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

function render(
  search: string,
  {
    audiobooksEnabled = true,
    providerEnabled = false,
    results,
  }: {
    audiobooksEnabled?: boolean;
    providerEnabled?: boolean;
    results?: SearchResults;
  } = {},
) {
  route.search = search;
  route.audiobooksEnabled = audiobooksEnabled;
  route.providerEnabled = providerEnabled;
  const client = new QueryClient();
  if (results) {
    const query = new URLSearchParams(search).get("q") ?? "";
    client.setQueryData(queries.search(query).queryKey, results);
  }
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
  const markup = render("tab=audiobooks&q=Hawking", { audiobooksEnabled: false });
  expect(markup).not.toContain(">nav.audiobooks</button>");
  expect(markup).not.toContain("search.audiobookPlaceholder");
});

it("opens the selected integration only while it is enabled", () => {
  const search = "tab=provider&q=Kingdom+of+Predators";
  const markup = render(search, { providerEnabled: true });
  expect(markup).toContain(">Provider</button>");
  expect(markup).toContain('data-provider-query="Kingdom of Predators"');
  expect(markup).not.toContain('value="Kingdom of Predators"');
  expect(markup).not.toContain(">nav.tracks</button>");
  expect(render(search)).toContain(">nav.tracks</button>");
  expect(render(search)).not.toContain("data-provider-query");
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

it("shows a sole matching track once when it is also the top result", () => {
  const track = { id: "first", title: "First tone" } as Track;
  const results: SearchResults = {
    tracks: [track],
    artists: [],
    albums: [],
    genres: [],
    top: { kind: "Track", track },
  };
  const markup = render("q=first", { results });

  expect(markup).not.toContain("data-top-result");
  expect(markup).toContain("<li>First tone</li>");
});

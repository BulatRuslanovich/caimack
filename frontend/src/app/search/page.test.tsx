// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { queries } from "@/lib/queries";
import type { SearchResults, SearchTopResult, Track } from "@/lib/types";
import SearchPage from "./page";
import type { MusicImport, MusicSource } from "@/integrations/music";

const route = vi.hoisted(() => ({
  search: "",
  audiobooksEnabled: true,
  isAdmin: false,
  externalSearch: true,
  linkImport: true,
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
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: route.isAdmin }) }));
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
vi.mock("@/integrations/registry", () => ({ useAvailableIntegrations: () => [] }));
vi.mock("@/integrations/useMusicSources", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/useMusicSources")>()),
  useExternalMusicSearch: () => route.externalSearch,
  usePlaylistLinkImport: () => route.linkImport,
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
    isAdmin = false,
    externalSearch = true,
    linkImport = true,
    results,
    playlistSource,
    importedJobs,
  }: {
    audiobooksEnabled?: boolean;
    isAdmin?: boolean;
    externalSearch?: boolean;
    linkImport?: boolean;
    results?: SearchResults;
    playlistSource?: MusicSource;
    importedJobs?: MusicImport[];
  } = {},
) {
  route.search = search;
  route.audiobooksEnabled = audiobooksEnabled;
  route.isAdmin = isAdmin;
  route.externalSearch = externalSearch;
  route.linkImport = linkImport;
  const client = new QueryClient();
  if (isAdmin) {
    client.setQueryData(
      ["music-sources", false],
      [
        {
          id: "soundcloud",
          name: "SoundCloud",
          status: "ready",
          audioStatus: "ready",
          capabilities: { tracks: true, audio: true },
        },
      ],
    );
  }
  if (playlistSource) {
    client.setQueryData(
      ["music-playlist-source", new URLSearchParams(search).get("q")],
      playlistSource,
    );
  }
  if (importedJobs) client.setQueryData(["music-imports"], importedJobs);
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

it("keeps old provider links in the common search without rendering a provider tab", () => {
  const markup = render("tab=vk&q=Kingdom+of+Predators", { isAdmin: true });
  expect(markup).toContain('value="Kingdom of Predators"');
  expect(markup).toContain(">nav.tracks</button>");
  expect(markup).toContain("music.sourceFilter");
  expect(markup).not.toContain(">VK Music</button>");
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

it("uses the main search field for a playlist import with external search off", () => {
  const link = "https://open.spotify.com/playlist/0123456789012345678901";
  const markup = render(`q=${encodeURIComponent(link)}`, {
    isAdmin: true,
    externalSearch: false,
    playlistSource: {
      id: "spotify",
      name: "Spotify",
      status: "ready",
      audioStatus: "ready",
      capabilities: { tracks: false, albums: false, playlist: true, audio: false },
    },
  });
  expect(markup).toContain("music.placeholder");
  expect(markup).toContain("music.readPlaylist");
  expect(markup).toContain(">Spotify</span>");
  expect(markup).not.toContain("search.nothingFound");
});

it("prompts for a playlist link before typing when external search is off", () => {
  const markup = render("", { isAdmin: true, externalSearch: false });

  expect(markup).toContain('placeholder="music.placeholder"');
  expect(markup).not.toContain("music.sourceFilter");
});

it("omits the playlist link prompt when only external search is on", () => {
  const markup = render("", { isAdmin: true, linkImport: false });

  expect(markup).toContain('placeholder="search.placeholderWithAudiobooks"');
  expect(markup).toContain("music.sourceFilter");
});

it("shows library results with the external search disabled", () => {
  const markup = render("q=first", {
    isAdmin: true,
    externalSearch: false,
    results: {
      tracks: [{ id: "first", title: "First tone" } as Track],
      artists: [],
      albums: [],
      genres: [],
    },
  });

  expect(markup).toContain("First tone");
  expect(markup).not.toContain("music.sourceFilter");
  expect(markup).not.toContain("music.externalResults");
});

it("shows the disabled link message without offering a playlist preview", () => {
  const link = "https://open.spotify.com/playlist/0123456789012345678901";
  const markup = render(`q=${encodeURIComponent(link)}`, { isAdmin: true, linkImport: false });

  expect(markup).toContain("music.linkImportDisabled");
  expect(markup).not.toContain("music.readPlaylist");
  expect(markup).not.toContain("music.externalResults");
});

it("keeps the previous import history out of search", () => {
  const markup = render("q=example", {
    isAdmin: true,
    importedJobs: [
      {
        id: "previous-job",
        title: "Previously imported track",
        state: "finished",
        error: null,
        playlistId: null,
        omitted: 0,
        partial: false,
        total: 1,
        done: 1,
        failed: 0,
      },
    ],
  });

  expect(markup).not.toContain("music.imports");
  expect(markup).not.toContain("Previously imported track");
});

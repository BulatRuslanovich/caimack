// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { queries } from "@/lib/queries";
import { CARD_PAGE_SIZE, TRACK_PAGE_SIZE } from "@/lib/pageSizes";
import { LibraryNavigationProvider } from "@/contexts/LibraryNavigationContext";
import { primaryNav } from "@/lib/navigation";
import { LibraryNavigation } from "./LibraryNavigation";
import { NavLink } from "./Sidebar";

type LinkProps = ComponentProps<"a"> & {
  onNavigate?: (event: { preventDefault: () => void }) => void;
};
const navigation = vi.hoisted(() => ({
  links: new Map<string, LinkProps>(),
  pathname: "/tracks",
}));
vi.mock("next/link", () => ({
  default: (props: LinkProps) => {
    navigation.links.set(props.href!, props);
    return <a href={props.href}>{props.children}</a>;
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));
vi.mock("@/lib/scroll", () => ({ scrollContentToTop: vi.fn() }));

function renderNavigation(client: QueryClient, node = <LibraryNavigation />) {
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <LibraryNavigationProvider>{node}</LibraryNavigationProvider>
    </QueryClientProvider>,
  );
}

function stubHistory(search = "") {
  const pushState = vi.fn();
  vi.stubGlobal("window", {
    location: {
      href: `http://localhost${navigation.pathname}${search}`,
      pathname: navigation.pathname,
      search,
    },
    history: { pushState },
  });
  return pushState;
}

const page = { items: [], total: 0, page: 1, pageSize: TRACK_PAGE_SIZE, totalPages: 0 };
const createClient = () =>
  new QueryClient({
    defaultOptions: { queries: { staleTime: 300_000, gcTime: Infinity, retry: false } },
  });

beforeEach(() => {
  navigation.links.clear();
  navigation.pathname = "/tracks";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("catalog tab navigation", () => {
  it.each(["onPointerEnter", "onFocus", "onTouchStart"] as const)(
    "loads Tracks through %s before navigation and reuses the response",
    async (intent) => {
      const client = createClient();
      const request = vi.spyOn(api, "tracks").mockResolvedValue(page);
      const options = queries.tracks({ page: 1, pageSize: TRACK_PAGE_SIZE, sort: "Title" });
      try {
        renderNavigation(client);
        expect(request).not.toHaveBeenCalled();
        navigation.links.get("/tracks")![intent]!({} as never);
        expect(request).toHaveBeenCalledOnce();
        await client.getQueryCache().find({ queryKey: options.queryKey })!.promise;
        expect(client.getQueryData(options.queryKey)).toEqual(page);
        await client.fetchQuery(options);
        expect(request).toHaveBeenCalledOnce();
      } finally {
        client.clear();
      }
    },
  );

  it("preloads the Artists feed used by the tab without a second request on opening", async () => {
    const client = createClient();
    const artistPage = { ...page, pageSize: CARD_PAGE_SIZE };
    const request = vi.spyOn(api, "artists").mockResolvedValue(artistPage);
    const options = queries.artistsFeed();
    try {
      renderNavigation(client);
      navigation.links.get("/artists")!.onFocus!({} as never);
      expect(request).toHaveBeenCalledOnce();
      await client.getQueryCache().find({ queryKey: options.queryKey })!.promise;
      expect(client.getQueryData(options.queryKey)).toEqual({
        pages: [artistPage],
        pageParams: [1],
      });
      await client.fetchInfiniteQuery(options);
      expect(request).toHaveBeenCalledOnce();
    } finally {
      client.clear();
    }
  });

  it("keeps normal links outside the workspace", () => {
    navigation.pathname = "/search";
    const client = createClient();
    renderNavigation(client);
    expect(navigation.links.get("/artists")!.onNavigate).toBeUndefined();
    client.clear();
  });

  it("leaves the saved folder in history until the requested catalog data is ready", async () => {
    navigation.pathname = "/library";
    const pushState = stubHistory("?folder=work");
    const albumPage = { ...page, pageSize: CARD_PAGE_SIZE };
    const albums = Promise.withResolvers<typeof albumPage>();
    const request = vi.spyOn(api, "albums").mockReturnValue(albums.promise);
    const client = createClient();
    try {
      renderNavigation(client, <LibraryNavigation saved />);
      // The catalog scope opens Tracks. Verify an album link inside the catalog separately.
      const tracks = Promise.withResolvers<typeof page>();
      vi.spyOn(api, "tracks").mockReturnValue(tracks.promise);
      const preventDefault = vi.fn();
      navigation.links.get("/tracks")!.onNavigate!({ preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(pushState).not.toHaveBeenCalled();
      tracks.resolve(page);
      await vi.waitFor(() =>
        expect(pushState).toHaveBeenCalledExactlyOnceWith(null, "", "/tracks"),
      );

      navigation.pathname = "/tracks";
      const pushCatalogState = stubHistory();
      renderNavigation(client);
      navigation.links.get("/albums")!.onNavigate!({ preventDefault });
      expect(request).toHaveBeenCalledOnce();
      expect(pushCatalogState).not.toHaveBeenCalled();
      albums.resolve(albumPage);
      await vi.waitFor(() =>
        expect(pushCatalogState).toHaveBeenCalledExactlyOnceWith(null, "", "/albums"),
      );
    } finally {
      client.clear();
    }
  });

  it("keeps the sidebar library active in catalog categories and details", async () => {
    const pushState = stubHistory();
    const client = createClient();
    const entry = primaryNav.find(({ href }) => href === "/library")!;
    const folders = Promise.withResolvers<[]>();
    vi.spyOn(api, "savedLibrary").mockResolvedValue([]);
    vi.spyOn(api, "libraryFolders").mockReturnValue(folders.promise);
    try {
      renderNavigation(client, <NavLink entry={entry} />);
      const link = navigation.links.get("/library")!;
      link.onNavigate!({ preventDefault: vi.fn() });
      expect(pushState).not.toHaveBeenCalled();
      folders.resolve([]);
      await vi.waitFor(() =>
        expect(pushState).toHaveBeenCalledExactlyOnceWith(null, "", "/library"),
      );

      for (const pathname of [
        "/tracks",
        "/albums",
        "/albums/album-id",
        "/artists",
        "/artists/artist-id",
        "/playlists",
        "/playlists/playlist-id",
        "/genres",
      ]) {
        navigation.pathname = pathname;
        renderNavigation(client, <NavLink entry={entry} />);
        expect(navigation.links.get("/library")!["aria-current"]).toBe("page");
      }

      for (const pathname of ["/search", "/favorites", "/albums-archive"]) {
        navigation.pathname = pathname;
        renderNavigation(client, <NavLink entry={entry} />);
        expect(navigation.links.get("/library")!["aria-current"]).toBeUndefined();
      }
    } finally {
      client.clear();
    }
  });

  it("keeps the current tab on failure and ignores an earlier click that finishes later", async () => {
    const pushState = stubHistory();
    const client = createClient();
    const albums = Promise.withResolvers<typeof page>();
    vi.spyOn(api, "albums").mockReturnValue(albums.promise);
    vi.spyOn(api, "artists").mockRejectedValueOnce(new Error("Unavailable"));
    try {
      renderNavigation(client);
      const event = { preventDefault: vi.fn() };
      navigation.links.get("/albums")!.onNavigate!(event);
      navigation.links.get("/artists")!.onNavigate!(event);
      await vi.waitFor(() =>
        expect(client.getQueryState(queries.artistsFeed().queryKey)?.status).toBe("error"),
      );
      albums.resolve(page);
      await vi.waitFor(() =>
        expect(client.getQueryData(queries.albumsFeed().queryKey)).toBeDefined(),
      );
      expect(pushState).not.toHaveBeenCalled();

      navigation.links.get("/albums")!.onNavigate!(event);
      await vi.waitFor(() =>
        expect(pushState).toHaveBeenCalledExactlyOnceWith(null, "", "/albums"),
      );
    } finally {
      client.clear();
    }
  });
});

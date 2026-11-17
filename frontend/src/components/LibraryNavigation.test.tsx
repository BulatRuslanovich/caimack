// SPDX-License-Identifier: AGPL-3.0-only
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { queries } from "@/lib/queries";
import { CARD_PAGE_SIZE, TRACK_PAGE_SIZE } from "@/lib/pageSizes";
import { LibraryNavigation } from "./LibraryNavigation";

type LinkProps = ComponentProps<"a"> & {
  onNavigate?: (event: { preventDefault: () => void }) => void;
};
const navigation = vi.hoisted(() => ({
  links: new Map<string, LinkProps>(),
  navigate: vi.fn(),
  inWorkspace: true,
}));
vi.mock("next/link", () => ({
  default: (props: LinkProps) => {
    navigation.links.set(props.href!, props);
    return <a href={props.href}>{props.children}</a>;
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/tracks" }));
vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));
vi.mock("@/contexts/LibraryNavigationContext", () => ({
  useLibraryNavigation: () => (navigation.inWorkspace ? navigation.navigate : null),
}));

function renderNavigation(client: QueryClient) {
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <LibraryNavigation />
    </QueryClientProvider>,
  );
}
const page = { items: [], total: 0, page: 1, pageSize: TRACK_PAGE_SIZE, totalPages: 0 };
const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { staleTime: 300_000, gcTime: Infinity } } });

beforeEach(() => {
  navigation.links.clear();
  navigation.navigate.mockClear();
  navigation.inWorkspace = true;
});
afterEach(() => vi.restoreAllMocks());

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

  it("uses the shared view when available and keeps normal links outside the workspace", () => {
    const client = createClient();
    try {
      renderNavigation(client);
      const preventDefault = vi.fn();
      navigation.links.get("/artists")!.onNavigate!({ preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(navigation.navigate).toHaveBeenCalledWith("/artists");
      navigation.inWorkspace = false;
      renderNavigation(client);
      expect(navigation.links.get("/artists")!.onNavigate).toBeUndefined();
    } finally {
      client.clear();
    }
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LibraryWorkspace } from "./LibraryWorkspace";
import { useLibraryNavigation } from "@/contexts/LibraryNavigationContext";

const route = vi.hoisted(() => ({ path: "/tracks", segment: "tracks" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.path,
  useSelectedLayoutSegment: () => route.segment,
}));
vi.mock("@/lib/scroll", () => ({ scrollContentToTop: vi.fn() }));
vi.mock("@/app/library/LibraryPage", () => ({ default: () => <p>Client library</p> }));
vi.mock("@/app/tracks/TracksPage", () => ({ TracksPage: () => <p>Client tracks</p> }));
vi.mock("@/app/albums/(list)/AlbumsPage", () => ({ AlbumsPage: () => <p>Client albums</p> }));
vi.mock("@/app/artists/(list)/ArtistsPage", () => ({ ArtistsPage: () => <p>Client artists</p> }));
vi.mock("@/app/playlists/(list)/PlaylistsPage", () => ({
  PlaylistsPage: () => <p>Client playlists</p>,
}));
vi.mock("@/app/genres/GenresPage", () => ({ GenresPage: () => <p>Client genres</p> }));

afterEach(() => vi.unstubAllGlobals());

describe("shared library workspace", () => {
  it("keeps the server-rendered view and its hydration boundary on a direct visit", () => {
    route.path = "/tracks";
    route.segment = "tracks";
    const markup = renderToStaticMarkup(
      <LibraryWorkspace>
        <p>Server tracks with data</p>
      </LibraryWorkspace>,
    );
    expect(markup).toContain("Server tracks with data");
    expect(markup).not.toContain("Client tracks");
  });

  it("renders the URL's client view while retaining the server route for history restoration", () => {
    route.path = "/albums";
    route.segment = "tracks";
    const markup = renderToStaticMarkup(
      <LibraryWorkspace>
        <p>Server tracks</p>
      </LibraryWorkspace>,
    );
    expect(markup).toContain("Client albums");
  });

  it("updates native history without replacing the server route or dropping folder history", () => {
    route.path = "/library";
    route.segment = "library";
    const pushState = vi.fn();
    vi.stubGlobal("window", {
      location: { pathname: "/library", search: "?folder=work" },
      history: { pushState },
    });
    let navigate: ReturnType<typeof useLibraryNavigation> = null;
    function Probe() {
      navigate = useLibraryNavigation();
      return null;
    }
    renderToStaticMarkup(
      <LibraryWorkspace>
        <Probe />
      </LibraryWorkspace>,
    );
    navigate!("/albums");
    expect(pushState).toHaveBeenCalledWith(null, "", "/albums");
  });
});

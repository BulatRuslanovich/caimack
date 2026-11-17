// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { Activity, useCallback, useState, type ComponentType, type ReactNode } from "react";
import { usePathname, useSelectedLayoutSegment } from "next/navigation";
import type { Route } from "next";
import LibraryPage from "@/app/library/LibraryPage";
import { TracksPage } from "@/app/tracks/TracksPage";
import { AlbumsPage } from "@/app/albums/(list)/AlbumsPage";
import { ArtistsPage } from "@/app/artists/(list)/ArtistsPage";
import { PlaylistsPage } from "@/app/playlists/(list)/PlaylistsPage";
import { GenresPage } from "@/app/genres/GenresPage";
import { LibraryNavigationContext } from "@/contexts/LibraryNavigationContext";
import { scrollContentToTop } from "@/lib/scroll";

const views: Record<string, ComponentType> = {
  "/library": LibraryPage,
  "/tracks": TracksPage,
  "/albums": AlbumsPage,
  "/artists": ArtistsPage,
  "/playlists": PlaylistsPage,
  "/genres": GenresPage,
};

/** The server supplies the initial view; tab changes reuse the browser's data and UI. */
export function LibraryWorkspace({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const segment = useSelectedLayoutSegment();
  // Native history changes the URL without replacing the server's route segment.
  const serverPath = `/${segment}`;
  const [visited, setVisited] = useState<string[]>([]);
  if (pathname !== serverPath && views[pathname] && !visited.includes(pathname)) {
    setVisited([...visited, pathname]);
  }
  const navigate = useCallback((href: Route) => {
    if (window.location.pathname === href && !window.location.search) return;
    window.history.pushState(null, "", href);
    scrollContentToTop();
  }, []);

  return (
    <LibraryNavigationContext.Provider value={navigate}>
      <Activity mode={pathname === serverPath ? "visible" : "hidden"}>{children}</Activity>
      {visited
        .filter((path) => path !== serverPath)
        .map((path) => {
          const View = views[path];
          return (
            <Activity key={path} mode={pathname === path ? "visible" : "hidden"}>
              <View />
            </Activity>
          );
        })}
    </LibraryNavigationContext.Provider>
  );
}

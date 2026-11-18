// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { Activity, useState, type ComponentType, type ReactNode } from "react";
import { usePathname, useSelectedLayoutSegment } from "next/navigation";
import LibraryPage from "@/app/library/LibraryPage";
import { TracksPage } from "@/app/tracks/TracksPage";
import { AlbumsPage } from "@/app/albums/(list)/AlbumsPage";
import { ArtistsPage } from "@/app/artists/(list)/ArtistsPage";
import { PlaylistsPage } from "@/app/playlists/(list)/PlaylistsPage";
import { GenresPage } from "@/app/genres/GenresPage";

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
  return (
    <>
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
    </>
  );
}

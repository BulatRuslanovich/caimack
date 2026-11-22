// SPDX-License-Identifier: AGPL-3.0-only

import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { LibraryItem } from "@/lib/types";
import { FolderCover } from "./FolderCover";

vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));

function item(id: string, fields: Partial<LibraryItem> = {}): LibraryItem {
  return {
    kind: "album",
    id,
    title: id,
    subtitle: "",
    hasImage: true,
    coverTrackId: null,
    savedAt: "",
    folderId: "folder",
    ...fields,
  };
}

function artworkSources(html: string) {
  return Array.from(html.matchAll(/<img[^>]* src="([^"]+)"/g), ([, src]) => src);
}

it("uses up to four images in the folder's saved order and adds a corner icon", () => {
  const items = ["a", "b", "c", "d", "e"].map((id) => item(id));
  const html = renderToStaticMarkup(<FolderCover items={items} order={["album:e", "album:d"]} />);

  expect(artworkSources(html)).toEqual(
    ["e", "d", "a", "b"].map((id) => `/api/albums/${id}/cover?size=thumb`),
  );
  expect(html).toContain("grid-cols-2 grid-rows-2");
  expect(html).toContain("lucide-folder");
  expect(html).toContain("absolute right-[5%] bottom-[5%]");
});

it("combines playlist and artist artwork and skips items without images", () => {
  const playlist = item("playlist", {
    kind: "playlist",
    hasImage: false,
    coverTracks: [{ id: "track", title: "Track", albumId: "mix", hasCover: true }],
  });
  const artist = item("artist", { kind: "artist" });
  const html = renderToStaticMarkup(
    <FolderCover items={[item("missing", { hasImage: false }), playlist, artist]} />,
  );

  expect(artworkSources(html)).toEqual([
    "/api/albums/mix/cover?size=thumb",
    "/api/artists/artist/image?size=thumb",
    "/api/albums/mix/cover?size=thumb",
    "/api/artists/artist/image?size=thumb",
  ]);
});

it("keeps the folder icon when there are no images", () => {
  const html = renderToStaticMarkup(<FolderCover items={[]} />);

  expect(artworkSources(html)).toEqual([]);
  expect(html).toContain("lucide-folder");
});

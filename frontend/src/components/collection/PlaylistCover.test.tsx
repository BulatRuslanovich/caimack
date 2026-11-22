// SPDX-License-Identifier: AGPL-3.0-only

import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { PlaylistCover } from "./PlaylistCover";

vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));

const playlist = {
  id: "mix",
  name: "Mix",
  hasCover: false,
  coverTracks: ["a", "a", "missing", "b", "c", "d", "e"].map((albumId, index) => ({
    id: String(index),
    title: `Song ${index}`,
    albumId,
    hasCover: albumId !== "missing",
  })),
};

function artworkSources(html: string) {
  return Array.from(html.matchAll(/<img[^>]* src="([^"]+)"/g), ([, src]) => src);
}

it("finds the first four different album covers in playlist order", () => {
  const html = renderToStaticMarkup(<PlaylistCover playlist={playlist} />);

  expect(html).toContain("grid-cols-2 grid-rows-2");
  expect(html).toContain("lucide-list-music");
  expect(html).toContain("absolute right-[5%] bottom-[5%]");
  expect(artworkSources(html)).toEqual(
    ["a", "b", "c", "d"].map((id) => `/api/albums/${id}/cover?size=thumb`),
  );
});

it("shows a track override next to artwork inherited from the same album", () => {
  const [first, second] = playlist.coverTracks;
  const coverTracks = [{ ...first, coverRevision: "new-art" }, second];
  const html = renderToStaticMarkup(<PlaylistCover playlist={{ ...playlist, coverTracks }} />);
  expect(artworkSources(html)).toEqual([
    "/api/tracks/0/cover?size=thumb&amp;v=new-art",
    "/api/albums/a/cover?size=thumb",
  ]);
});

it.each([
  [4, ["a", "b"], "grid-rows-1"],
  [5, ["a", "b", "c"], "row-span-2"],
])("fills the grid without repeats for a playlist with %i tracks", (count, expected, layout) => {
  const coverTracks = playlist.coverTracks.slice(0, count);
  const html = renderToStaticMarkup(<PlaylistCover playlist={{ ...playlist, coverTracks }} />);

  expect(html).toContain(layout);
  expect(artworkSources(html)).toEqual(expected.map((id) => `/api/albums/${id}/cover?size=thumb`));
});

it("uses one image when all cover tracks share an album and gives an uploaded cover priority", () => {
  const single = { ...playlist, coverTracks: playlist.coverTracks.slice(0, 3) };
  expect(artworkSources(renderToStaticMarkup(<PlaylistCover playlist={single} />))).toEqual([
    "/api/albums/a/cover?size=thumb",
  ]);
  expect(
    artworkSources(
      renderToStaticMarkup(<PlaylistCover playlist={{ ...playlist, hasCover: true }} />),
    ),
  ).toEqual(["/api/playlists/mix/cover?size=thumb"]);
});

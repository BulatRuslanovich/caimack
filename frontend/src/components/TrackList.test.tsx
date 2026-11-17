// SPDX-License-Identifier: AGPL-3.0-only
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrackList } from "./TrackList";
import type { Track } from "@/lib/types";

const sortable = vi.hoisted(() =>
  vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  })),
);
vi.mock("@dnd-kit/sortable", async (original) => ({
  ...(await original<typeof import("@dnd-kit/sortable")>()),
  useSortable: sortable,
}));
vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));
vi.mock("@/contexts/PlayerContext", () => ({
  useNowPlaying: () => ({ currentTrackId: null, isPlaying: false }),
  usePlayerActions: () => ({}),
}));
vi.mock("@/lib/useToggleFavorite", () => ({ useToggleFavorite: () => () => {} }));
vi.mock("@/lib/useFormat", () => ({ useFormat: () => ({ playedAt: () => "" }) }));
vi.mock("./Cover", () => ({ TrackCover: () => null }));
vi.mock("./ArtistLinks", () => ({ ArtistLinks: () => null }));
vi.mock("./PrefetchLink", () => ({
  PrefetchLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("./TrackMenu", () => ({ TrackMenu: () => null }));
const tracks = ["First", "Second"].map(
  (title, index) =>
    ({
      id: `track-${index}`,
      title,
      artistId: "artist",
      artistName: "Artist",
      durationSeconds: 180,
      hasCover: false,
      isFavorite: false,
      codec: "mp3",
    }) as Track,
);

beforeEach(() => sortable.mockClear());

describe("catalog track rows", () => {
  it("renders read-only catalog rows without registering drag sensors", () => {
    const markup = renderToStaticMarkup(<TrackList tracks={tracks} />);
    expect(markup).toContain("First");
    expect(markup).toContain("Second");
    expect(sortable).not.toHaveBeenCalled();
    expect(markup).not.toContain("tracks.reorderNamed");
  });

  it("retains sortable rows and handles in an editable playlist", () => {
    const markup = renderToStaticMarkup(
      <TrackList tracks={tracks} playlistId="playlist" onReorder={() => {}} />,
    );
    expect(sortable).toHaveBeenCalledTimes(tracks.length);
    expect(markup.match(/tracks.reorderNamed/g)).toHaveLength(tracks.length);
  });

  it("bounds DOM and sortable registrations for a large playlist, retaining its accessible row count", () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({
      ...tracks[0],
      id: `track-${i}`,
      title: `Track ${i}`,
    }));
    const markup = renderToStaticMarkup(
      <TrackList tracks={many} playlistId="playlist" onReorder={() => {}} />,
    );
    expect(markup).toContain('aria-rowcount="1001"');
    expect(markup).toContain('aria-rowindex="2"');
    expect(markup).toContain("Track 0");
    expect(markup).not.toContain("Track 999");
    expect(sortable.mock.calls.length).toBeGreaterThan(0);
    expect(sortable.mock.calls.length).toBeLessThan(40);
  });
});

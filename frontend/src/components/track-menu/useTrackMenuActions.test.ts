// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Track } from "@/lib/types";
import { useTrackMenuActions } from "./useTrackMenuActions";

const mocks = vi.hoisted(() => ({
  changePlaylistMembership: vi.fn().mockResolvedValue(undefined),
  removeFromPlaylist: vi.fn().mockResolvedValue(undefined),
  playlist: vi
    .fn()
    .mockResolvedValue({
      tracks: [{ id: "previous" }, { id: "new" }, { id: "next" }, { id: "track" }],
    }),
  reorderPlaylist: vi.fn().mockResolvedValue(undefined),
  invalidate: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: mocks }));
vi.mock("@/lib/events", () => ({ recordEvent: vi.fn() }));
vi.mock("@/lib/useInvalidate", () => ({ useInvalidate: () => mocks.invalidate }));
vi.mock("@/lib/useToast", () => ({
  useToast: () => ({ notify: mocks.notify, notifyError: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));
vi.mock("@/contexts/PlayerContext", () => ({ usePlayerActions: () => ({}) }));
vi.mock("@/lib/useRecommendations", () => ({ useRecommendations: () => false }));
vi.mock("../ui/alert-dialog", () => ({ useConfirm: () => [vi.fn(), null] }));

it("undoes a menu removal using the saved order and preserves newly added tracks", async () => {
  const client = new QueryClient();
  const close = vi.fn();
  let actions!: ReturnType<typeof useTrackMenuActions>;
  function Probe() {
    actions = useTrackMenuActions({
      track: { id: "track", artistId: "artist", artistName: "Artist" } as Track,
      onOpenChange: close,
      playlistTrackIds: ["previous", "track", "next"],
    });
    return null;
  }
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe)));
  await actions.removeFromPlaylist.mutateAsync("playlist");
  expect(mocks.removeFromPlaylist).toHaveBeenCalledWith("playlist", "track");
  mocks.notify.mock.calls[0][2].run();

  await vi.waitFor(() => {
    expect(mocks.changePlaylistMembership).toHaveBeenCalledWith("playlist", ["track"], true);
    expect(mocks.reorderPlaylist).toHaveBeenCalledWith("playlist", [
      "previous",
      "track",
      "new",
      "next",
    ]);
    expect(mocks.invalidate).toHaveBeenCalledTimes(2);
    expect(mocks.invalidate).toHaveBeenLastCalledWith("library", "playlists");
  });
  client.clear();
});

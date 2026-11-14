// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Playlist, Track } from "@/lib/types";
import { useTrackMenuActions } from "./useTrackMenuActions";

const mocks = vi.hoisted(() => ({
  addToPlaylist: vi.fn().mockResolvedValue(undefined),
  invalidate: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: { addToPlaylist: mocks.addToPlaylist } }));
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

it("invalidates playlist views after adding a track through its menu", async () => {
  const client = new QueryClient();
  const close = vi.fn();
  let actions!: ReturnType<typeof useTrackMenuActions>;
  function Probe() {
    actions = useTrackMenuActions({
      track: { id: "track", artistId: "artist", artistName: "Artist" } as Track,
      onOpenChange: close,
    });
    return null;
  }
  renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe)));
  await actions.addTo.mutateAsync({ id: "playlist", name: "Playlist" } as Playlist);

  expect(mocks.addToPlaylist).toHaveBeenCalledWith("playlist", ["track"]);
  expect(mocks.invalidate).toHaveBeenCalledWith("playlists");
  expect(close).toHaveBeenCalledWith(false);
  client.clear();
});

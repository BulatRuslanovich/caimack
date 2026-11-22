// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Track } from "@/lib/types";
import { TopResult } from "./TopResult";

const nowPlaying = vi.hoisted(() => ({ currentTrackId: "match", isPlaying: true }));
const track = { id: "match", title: "House of Cards", artistName: "Machine Girl" } as Track;
const queue = [{ id: "previous" } as Track, track, { id: "next" } as Track];

vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));
vi.mock("@/contexts/PlayerContext", () => ({
  useNowPlaying: () => nowPlaying,
  usePlayerQueue: () => queue,
  usePlayerActions: () => ({}),
}));

it.each([
  { currentTrackId: track.id, isPlaying: true, label: "action.pause" },
  { currentTrackId: track.id, isPlaying: false, label: "action.playNamed" },
  { currentTrackId: "next", isPlaying: true, label: "action.playNamed" },
])("shows $label for a track match while the queue has other tracks", ({ label, ...state }) => {
  Object.assign(nowPlaying, state);

  const markup = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TopResult top={{ kind: "Track", track }} />
    </QueryClientProvider>,
  );

  expect(markup).toContain(`aria-label="${label}"`);
});

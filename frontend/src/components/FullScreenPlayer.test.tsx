// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { FullScreenPlayer } from "./FullScreenPlayer";

const playback = vi.hoisted(() => ({
  currentTrack: {
    id: "track",
    title: "A song that keeps playing",
    artistName: "Artist",
    durationSeconds: 200,
  },
  sleepTimer: null,
}));
function passthrough({ children }: { children?: ReactNode }) {
  return children;
}
vi.mock("@radix-ui/react-dialog", () => ({
  Root: passthrough,
  Portal: passthrough,
  Content: passthrough,
  Title: passthrough,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/contexts/PlayerContext", () => ({
  usePlayerState: () => playback,
  usePlayer: () => playback,
  useArtworkDirection: () => 1,
  usePlayerClock: () => () => 0,
}));
vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));
vi.mock("@/lib/playback/useConnectPlayback", () => ({ useConnect: () => ({ selectedId: null }) }));
vi.mock("@/lib/tatarMafia", () => ({ useTatarMafia: () => false }));
vi.mock("@/lib/useIdle", () => ({ useIdle: () => false }));
vi.mock("@/lib/playback/usePlaybackProgress", () => ({
  usePlaybackProgress: () => ({ position: 0, total: 200 }),
}));
vi.mock("./ArtworkScene", () => ({ ArtworkScene: passthrough }));
vi.mock("./ArtBackdrop", () => ({ PlayerBackdrop: () => null }));
vi.mock("./PlayerEffectsBackdrop", () => ({ PlayerEffectsBackdrop: () => null }));
vi.mock("./RecordTransition", () => ({ RecordTransition: () => null }));
vi.mock("./PlayerTransport", () => ({
  PlayerTransport: () => <button>Playback transport</button>,
}));
vi.mock("./PlayerVolume", () => ({ PlayerVolume: () => null }));
vi.mock("./PlayerOptionsMenu", () => ({ PlayerOptionsMenu: () => null }));
vi.mock("./PlaybackDevices", () => ({ PlaybackDevices: () => null }));
vi.mock("./SleepTimerButton", () => ({ SleepTimerButton: () => null }));
vi.mock("./StreamQuality", () => ({ StreamQuality: () => null }));
vi.mock("./WaveformSeekbar", () => ({ WaveformSeekbar: () => null }));
vi.mock("./ArtistLinks", () => ({ ArtistLinks: () => "Artist" }));
vi.mock("./TrackMenu", () => ({
  TrackMenu: () => {
    throw new Promise(() => {});
  },
}));

it("keeps the fullscreen surface and transport visible while an action menu chunk is pending", () => {
  const markup = renderToStaticMarkup(
    <FullScreenPlayer onClose={() => {}} onToggleFavorite={() => {}} />,
  );
  expect(markup).toContain('data-player-fullscreen="true"');
  expect(markup).toContain("A song that keeps playing");
  expect(markup).toContain("Playback transport");
});

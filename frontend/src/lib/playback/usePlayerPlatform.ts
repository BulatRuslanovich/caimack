// SPDX-License-Identifier: AGPL-3.0-only

import { useT } from "@/contexts/I18nContext";
import { useToast } from "@/lib/useToast";
import type { Dispatch, SetStateAction } from "react";
import type { useConnectPlayback } from "./useConnectPlayback";
import { useExclusivePlayback } from "./useExclusivePlayback";
import { useMediaSession } from "./useMediaSession";

export function usePlayerPlatform(
  connected: ReturnType<typeof useConnectPlayback>,
  play: () => void,
  setIsPlaying: Dispatch<SetStateAction<boolean>>,
  ownMediaSession = true,
) {
  const { notify } = useToast();
  const t = useT();
  useExclusivePlayback(connected.shouldHold, {
    onClaimed: () => {
      connected.claimed();
      void connected.report().catch(() => {});
    },
    onDisplaced: (takeover) => {
      setIsPlaying(false);
      connected.displaced();
      notify(
        t(takeover?.deviceName ? "player.playingOn" : "player.playingElsewhere", {
          device: takeover?.deviceName ?? "",
        }),
        "info",
      );
    },
  });
  useMediaSession(
    connected.state.currentTrack,
    connected.state.isPlaying,
    connected.progress.duration,
    {
      play: connected.controls.selectedId
        ? () => {
            if (!connected.state.isPlaying) connected.actions.toggle();
          }
        : play,
      pause: connected.actions.pause,
      next: connected.actions.next,
      previous: connected.actions.previous,
      seek: connected.actions.seek,
      seekBy: connected.actions.seekBy,
      getPosition: connected.progress.getPosition,
    },
    ownMediaSession,
  );
}

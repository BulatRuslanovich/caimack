// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { trackCoverUrl } from "@/lib/media";
import type { ArtworkDirection } from "@/lib/playback/useArtworkNavigation";
import type { Track } from "@/lib/types";
import { useCoverTone } from "@/lib/useCoverTone";
import { useArtworkTransition } from "@/lib/visuals/useArtworkTransition";

type Scene = ReturnType<typeof useArtworkTransition<Track>> & { trackId: string };
const Context = createContext<Scene | null>(null);

export function ArtworkScene({
  track,
  direction,
  children,
}: {
  track: Track;
  direction: ArtworkDirection;
  children: ReactNode;
}) {
  const src = trackCoverUrl(track, "thumb");
  const tone = useCoverTone(src, "player");
  const scene = useArtworkTransition({
    key: `${track.id}:${src ?? ""}`,
    item: track,
    src,
    tone,
    direction,
  });
  const value = useMemo(() => ({ ...scene, trackId: track.id }), [scene, track.id]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useArtworkScene(): Scene {
  const scene = useContext(Context);
  if (!scene) throw new Error("ArtworkScene is missing");
  return scene;
}

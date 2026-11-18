// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useEffect } from "react";
import { trackCoverUrl } from "@/lib/media";
import { setCoverPaletteTone, useColorway } from "@/lib/theme";
import { toneStyle, useCoverTone } from "@/lib/useCoverTone";
import { usePlayerState } from "@/contexts/PlayerContext";

export function NowPlayingTone() {
  const { currentTrack } = usePlayerState();
  const cover = currentTrack ? trackCoverUrl(currentTrack, "thumb") : null;
  const tone = useCoverTone(cover);
  const adaptive = useColorway() === "cover";
  const paletteTone = useCoverTone(adaptive ? cover : null, "player");

  useEffect(() => {
    if (paletteTone !== undefined) setCoverPaletteTone(paletteTone);
  }, [paletteTone]);

  useEffect(() => () => setCoverPaletteTone(null), []);

  useEffect(() => {
    if (tone === undefined) return;

    const root = document.documentElement;
    for (const [name, value] of Object.entries(toneStyle(tone))) {
      root.style.setProperty(name, String(value));
    }
  }, [tone]);

  return null;
}

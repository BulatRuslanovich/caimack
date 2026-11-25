// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { cn } from "@/lib/cn";
import type { Track } from "@/lib/types";
import { usePlayback } from "@/lib/playback/usePlayback";
import type { PlaybackCollection } from "@/lib/playback/playerTypes";
import { useT } from "@/contexts/I18nContext";
import { Button } from "./ui/button";
import { PauseIcon, PlayIcon } from "lucide-react";

export function PlayAllButton({
  tracks,
  name,
  compact = false,
  className,
  collection,
}: {
  tracks: Track[];
  name?: string;
  compact?: boolean;
  className?: string;
  collection?: PlaybackCollection;
}) {
  const t = useT();
  const { isPlaying, playSet, setIsOnAir } = usePlayback(collection);

  const playing = setIsOnAir(tracks) && isPlaying;

  return (
    <Button
      variant="play"
      size="play"
      className={cn(compact && "max-md:size-11", className)}
      disabled={tracks.length === 0}
      onClick={() => playSet(tracks)}
      aria-label={
        playing ? t("action.pause") : name ? t("action.playNamed", { name }) : t("action.play")
      }
    >
      {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
    </Button>
  );
}

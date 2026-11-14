// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { PauseIcon, PlayIcon } from "lucide-react";
import { useT } from "@/contexts/I18nContext";
import { BufferingRing } from "./PlaybackIndicators";
import { Button } from "./ui/button";

export function PlayPauseButton({
  playing,
  buffering,
  onToggle,
  size = "bar",
}: {
  playing: boolean;
  buffering: boolean;
  onToggle: () => void;
  size?: "compact" | "bar" | "full";
}) {
  const t = useT();
  const iconSize = size === "full" ? 34 : size === "compact" ? 24 : 28;
  return (
    <Button
      variant="play"
      size={size === "full" ? "play-lg" : size === "compact" ? "icon" : "play"}
      className="transport-main relative"
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") event.stopPropagation();
      }}
      aria-label={playing ? t("action.pause") : t("action.play")}
      aria-busy={buffering}
    >
      {playing ? <PauseIcon size={iconSize} /> : <PlayIcon size={iconSize} />}
      {buffering && <BufferingRing />}
    </Button>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { ShuffleIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Track } from "@/lib/types";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { Button } from "./ui/button";

export function ShuffleButton({
  tracks,
  compact = false,
  iconOnly = false,
}: {
  tracks: Track[];
  compact?: boolean;
  iconOnly?: boolean;
}) {
  const t = useT();
  const player = usePlayerActions();
  const { shuffle } = usePlayerState();

  return (
    <Button
      onClick={player.toggleShuffle}
      aria-pressed={shuffle}
      disabled={tracks.length === 0}
      variant={iconOnly ? "ghost" : "secondary"}
      size={iconOnly ? "icon-lg" : "md"}
      title={iconOnly ? t("action.shuffle") : undefined}
      className={cn(
        compact && "max-md:size-10 max-md:px-0 pointer-coarse:max-md:size-11",
        iconOnly && shuffle && "bg-primary-soft text-primary hover:text-primary",
      )}
    >
      <ShuffleIcon size={iconOnly ? 20 : 16} />
      <span className={cn(iconOnly && "sr-only", compact && "max-md:sr-only")}>
        {t("action.shuffle")}
      </span>
    </Button>
  );
}

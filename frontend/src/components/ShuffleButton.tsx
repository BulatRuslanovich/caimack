// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { ShuffleIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Track } from "@/lib/types";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { Button } from "./ui/button";

export function ShuffleButton({ tracks, compact = false }: { tracks: Track[]; compact?: boolean }) {
  const t = useT();
  const player = usePlayerActions();
  const { shuffle } = usePlayerState();

  return (
    <Button
      onClick={player.toggleShuffle}
      aria-pressed={shuffle}
      disabled={tracks.length === 0}
      className={cn(
        compact && "max-md:size-11 max-md:px-0",
        shuffle &&
          "border-primary bg-primary-soft text-primary hover:border-primary hover:bg-primary-soft",
      )}
    >
      <ShuffleIcon size={16} />
      <span className={cn(compact && "max-md:sr-only")}>{t("action.shuffle")}</span>
    </Button>
  );
}

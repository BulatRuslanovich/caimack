// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

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
        compact && "max-sm:w-10 max-sm:px-0",
        shuffle &&
          "border-primary bg-primary text-primary-foreground hover:border-primary hover:bg-primary/90",
      )}
    >
      <ShuffleIcon size={16} />
      <span className={cn(compact && "max-sm:sr-only")}>{t("action.shuffle")}</span>
    </Button>
  );
}

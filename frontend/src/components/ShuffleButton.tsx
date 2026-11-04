// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { ShuffleIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { buildOrder } from "@/lib/playback/playerQueue";
import type { Track } from "@/lib/types";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { Button } from "./ui/button";

export function ShuffleButton({ tracks, compact = false }: { tracks: Track[]; compact?: boolean }) {
  const t = useT();
  const player = usePlayerActions();

  const shuffle = () => {
    const order = buildOrder(tracks.length, true, -1);
    player.playQueue(
      order.map((index) => tracks[index]),
      0,
    );
  };

  return (
    <Button
      onClick={shuffle}
      disabled={tracks.length === 0}
      className={cn(compact && "max-sm:w-10 max-sm:px-0")}
    >
      <ShuffleIcon size={16} />
      <span className={cn(compact && "max-sm:sr-only")}>{t("action.shuffle")}</span>
    </Button>
  );
}

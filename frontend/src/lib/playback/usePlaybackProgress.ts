// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { formatDuration } from "@/lib/format";
import { toggleRemainingTime, useRemainingTime } from "@/lib/useRemainingTime";
import { usePlayerActions, usePlayerProgress } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";

export function usePlaybackProgress(fallbackDuration: number) {
  const { position, duration, buffered } = usePlayerProgress();
  const { seek } = usePlayerActions();
  const showRemaining = useRemainingTime();
  const t = useT();

  const total = duration || fallbackDuration;

  return {
    position,
    total,
    bufferedPercent: total > 0 ? Math.min(100, (buffered / total) * 100) : 0,
    seek,
    seekLabel: t("player.seek"),
    valueText: (value: number) =>
      t("player.position", { position: formatDuration(value), total: formatDuration(total) }),
    toggleRemainingTime,
    toggleRemainingLabel: t("player.toggleRemaining"),
    endLabel: showRemaining
      ? `-${formatDuration(Math.max(0, total - position))}`
      : formatDuration(total),
  };
}

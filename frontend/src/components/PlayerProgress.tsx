// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useT } from "@/contexts/I18nContext";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import { SEEK_STEP } from "@/lib/shortcuts";
import { toggleRemainingTime, useRemainingTime } from "@/lib/useRemainingTime";
import { Seekbar } from "./Seekbar";

export function PlayerProgress({
  position,
  total,
  seek,
  bufferedPercent = 0,
  expanded = false,
  seekLabel,
}: {
  position: number;
  total: number;
  seek: (position: number) => void;
  bufferedPercent?: number;
  expanded?: boolean;
  seekLabel?: string;
}) {
  const t = useT();
  const showRemaining = useRemainingTime();
  const endLabel = showRemaining
    ? `-${formatDuration(Math.max(0, total - position))}`
    : formatDuration(total);
  const clock = "w-10 shrink-0 text-2xs text-faint tabular-nums";
  const end = (
    <button
      type="button"
      onClick={toggleRemainingTime}
      aria-label={t("player.toggleRemaining")}
      title={t("player.toggleRemaining")}
      className={cn("rounded-sm hover:text-foreground", !expanded && cn(clock, "text-left"))}
    >
      {endLabel}
    </button>
  );
  return (
    <div className={expanded ? "flex flex-col gap-0.5" : "flex w-full items-center gap-2"}>
      {!expanded && <span className={cn(clock, "text-right")}>{formatDuration(position)}</span>}
      <Seekbar
        className={expanded ? undefined : "min-w-0 flex-1"}
        variant="player"
        value={position}
        max={total}
        onSeek={seek}
        ariaLabel={seekLabel ?? t("player.seek")}
        valueText={(value) =>
          t("player.position", { position: formatDuration(value), total: formatDuration(total) })
        }
        keyStep={SEEK_STEP}
        style={{ "--buffered": `${bufferedPercent}%` } as React.CSSProperties}
        tooltip={formatDuration}
        commitOnRelease
      />
      {expanded ? (
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>{formatDuration(position)}</span>
          {end}
        </div>
      ) : (
        end
      )}
    </div>
  );
}

export function PlayerProgressLine({ position, total }: { position: number; total: number }) {
  return (
    <PlayerProgressMeter
      percent={total > 0 ? (position / total) * 100 : 0}
      className="player-progress md:hidden"
    />
  );
}

export function PlayerProgressMeter({
  percent,
  label,
  className,
}: {
  percent: number;
  label?: string;
  className?: string;
}) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <span
      role={label ? "progressbar" : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      aria-valuenow={label ? Math.round(value) : undefined}
      className={cn("block h-0.5 overflow-hidden rounded-full bg-foreground/16", className)}
    >
      <span
        className="player-progress-fill"
        style={{
          width: `${value}%`,
        }}
      />
    </span>
  );
}

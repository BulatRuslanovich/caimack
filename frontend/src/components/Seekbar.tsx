// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { CSSProperties, PointerEvent, SyntheticEvent, useId, useState } from "react";
import { cn } from "@/lib/cn";

interface SeekbarProps {
  value: number;
  max: number;
  step?: number;
  onSeek: (value: number) => void;
  ariaLabel: string;
  className?: string;
  style?: CSSProperties;
  commitOnRelease?: boolean;
  tooltip?: (value: number) => string;
  valueText?: (value: number) => string;
  keyStep?: number;
  variant?: "default" | "player";
}

export function Seekbar({
  value,
  max,
  step,
  onSeek,
  ariaLabel,
  className = "",
  style,
  commitOnRelease = false,
  tooltip,
  valueText,
  keyStep,
  variant = "default",
}: SeekbarProps) {
  const id = useId();
  const safeMax = max > 0 ? max : 0;
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);

  const displayValue = dragValue ?? Math.min(value, safeMax || 1);
  const percent = safeMax > 0 ? Math.min(100, (displayValue / safeMax) * 100) : 0;

  const commit = (event: SyntheticEvent<HTMLInputElement>) => {
    if (dragValue === null) return;
    setDragValue(null);
    onSeek(Number(event.currentTarget.value));
  };

  const trackHover = (event: PointerEvent<HTMLInputElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;

    setHoverRatio(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)));
  };

  const input = (
    <input
      id={id}
      type="range"
      className={cn(
        "seekbar",
        variant === "player" && "player-seek",
        tooltip ? "w-full" : className,
      )}
      min={0}
      max={safeMax || 1}
      step={step ?? 0.5}
      value={displayValue}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (commitOnRelease) setDragValue(next);
        else onSeek(next);
      }}
      onKeyDown={(event) => {
        if (!keyStep) return;

        const direction =
          event.key === "ArrowRight" || event.key === "ArrowUp"
            ? 1
            : event.key === "ArrowLeft" || event.key === "ArrowDown"
              ? -1
              : 0;
        if (direction === 0) return;

        event.preventDefault();
        const next = Math.min(safeMax, Math.max(0, displayValue + direction * keyStep));
        if (commitOnRelease) setDragValue(next);
        else onSeek(next);
      }}
      onPointerUp={commitOnRelease ? commit : undefined}
      onKeyUp={commitOnRelease ? commit : undefined}
      onPointerMove={tooltip ? trackHover : undefined}
      onPointerLeave={tooltip ? () => setHoverRatio(null) : undefined}
      aria-label={ariaLabel}
      aria-valuetext={valueText?.(displayValue)}
      style={{ ...style, ["--progress" as string]: `${percent}%` }}
      disabled={safeMax === 0}
    />
  );

  if (!tooltip) return input;

  return (
    <span className={cn("relative block", className)}>
      {input}

      {hoverRatio !== null && safeMax > 0 && (
        <span
          aria-hidden="true"
          style={{ left: `clamp(1.75rem, ${hoverRatio * 100}%, calc(100% - 1.75rem))` }}
          className={cn(
            "pointer-events-none absolute z-10 -translate-x-1/2 bottom-full mb-1",
            "rounded-md bg-popover px-2 py-0.5 text-2xs whitespace-nowrap",
            "text-popover-foreground shadow-pop tabular-nums",
            "[@media(pointer:coarse)]:hidden",
          )}
        >
          {tooltip(hoverRatio * safeMax)}
        </span>
      )}
    </span>
  );
}

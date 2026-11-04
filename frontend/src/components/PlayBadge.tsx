// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { cn } from "@/lib/cn";
import { PauseIcon, PlayIcon } from "lucide-react";

export function PlayBadge({
  playing,
  visible = false,
  standalone = false,
  size = 9,
  className,
}: {
  playing: boolean;
  visible?: boolean;
  standalone?: boolean;
  size?: 8 | 9;
  className?: string;
}) {
  const icon = size === 8 ? 16 : 18;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-action text-action-foreground shadow-art",
        size === 8 ? "size-8" : "size-9",
        "translate-y-1 opacity-0 transition-[opacity,transform] duration-150 ease-brand",
        "group-hover:translate-y-0 group-hover:opacity-100",
        "group-focus-visible:translate-y-0 group-focus-visible:opacity-100",
        "group-has-focus-visible:translate-y-0 group-has-focus-visible:opacity-100",
        standalone && "[@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100",
        "group-active:scale-95",
        visible && "translate-y-0 opacity-100",
        className,
      )}
    >
      {playing ? <PauseIcon size={icon} /> : <PlayIcon size={icon} />}
    </span>
  );
}

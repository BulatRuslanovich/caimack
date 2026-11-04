// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { cn } from "@/lib/cn";

export function BufferingRing() {
  return <span aria-hidden="true" className="buffering-ring" />;
}

export function NowPlayingBars({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("now-playing-bars", className)}>
      <span />
      <span />
      <span />
    </span>
  );
}

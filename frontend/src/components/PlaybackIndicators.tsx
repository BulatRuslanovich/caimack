// SPDX-License-Identifier: AGPL-3.0-only

import { AudioLinesIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export function PlayingGlyph() {
  return <AudioLinesIcon aria-hidden="true" className="playing-title-icon hidden" />;
}

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

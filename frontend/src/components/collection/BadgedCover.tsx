// SPDX-License-Identifier: AGPL-3.0-only

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function BadgedCover({
  icon: Icon,
  hasArtwork,
  children,
}: {
  icon: LucideIcon;
  hasArtwork: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative size-full [container-type:inline-size]">
      {children}
      <Icon
        aria-hidden="true"
        strokeWidth={2.25}
        className={cn(
          "pointer-events-none absolute right-[5%] bottom-[5%] size-[clamp(0.875rem,20cqw,1.75rem)]",
          hasArtwork ? "text-white drop-shadow-[0_1px_2px_rgb(0_0_0/95%)]" : "text-primary",
        )}
      />
    </div>
  );
}

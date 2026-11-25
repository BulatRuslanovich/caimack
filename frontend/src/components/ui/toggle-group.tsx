// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function ToggleGroup({
  className,
  mobileChips = false,
  ...props
}: ComponentProps<"div"> & { mobileChips?: boolean }) {
  return (
    <div
      role="group"
      className={cn(
        "flex items-center gap-x-6 overflow-x-auto shadow-[inset_0_-1px_0_var(--border)]",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        mobileChips && "catalog-mobile-chips",
        className,
      )}
      {...props}
    />
  );
}

export function ToggleGroupButton({
  className,
  active,
  ...props
}: ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 border-b-2 border-transparent pt-1 pb-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-150 ease-brand outline-none hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
        active && "border-primary text-foreground hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

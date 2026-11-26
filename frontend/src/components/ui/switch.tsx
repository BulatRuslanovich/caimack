// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-6 w-10 shrink-0 items-center rounded-full border-2 transition-colors",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=unchecked]:border-control-border data-[state=unchecked]:bg-card",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-4 rounded-full transition-[translate,background-color]",
          "data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary-foreground data-[state=unchecked]:bg-foreground",
          "ml-0.5 motion-reduce:transition-none",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

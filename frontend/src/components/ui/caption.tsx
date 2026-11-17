// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Caption({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

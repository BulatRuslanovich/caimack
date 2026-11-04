// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

export function Table({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      role="table"
      className={cn("flex flex-col overflow-hidden rounded-lg", className)}
      {...props}
    />
  );
}

export function Row({
  className,
  head = false,
  ...props
}: ComponentProps<"div"> & { head?: boolean }) {
  return (
    <div
      role="row"
      className={cn(
        "grid items-center gap-3 px-4 py-3 text-sm",
        "max-md:grid-cols-1 max-md:gap-1",
        head
          ? "border-b border-border text-xs text-muted-foreground max-md:hidden"
          : "hover:bg-card",
        className,
      )}
      {...props}
    />
  );
}

export function Cell({ className, ...props }: ComponentProps<"span">) {
  return <span role="cell" className={cn("min-w-0", className)} {...props} />;
}

export function HeaderCell({ className, ...props }: ComponentProps<"span">) {
  return <span role="columnheader" className={cn("min-w-0", className)} {...props} />;
}

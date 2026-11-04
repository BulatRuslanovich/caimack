// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  bare = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  bare?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 px-6 py-10 text-center",
        !bare && "rounded-lg bg-card",
      )}
    >
      {icon && (
        <span
          aria-hidden="true"
          className="mb-1 grid size-14 place-items-center rounded-full bg-raised text-faint"
        >
          {icon}
        </span>
      )}
      <h3 className="text-section font-semibold">{title}</h3>
      {description && <p className="max-w-md text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

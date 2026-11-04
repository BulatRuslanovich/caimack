// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function StatusPage({
  icon,
  tone = "muted",
  title,
  description,
  actions,
}: {
  icon: ReactNode;
  tone?: "muted" | "danger";
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-[50vh] flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center">
      <span
        className={cn(
          "mb-2 grid size-20 place-items-center rounded-full",
          tone === "danger" ? "bg-destructive/15 text-destructive" : "bg-card text-faint",
        )}
      >
        {icon}
      </span>
      <h1 className="text-xl">{title}</h1>
      {description && <p className="max-w-md text-muted-foreground">{description}</p>}
      {actions && <div className="mt-2 flex flex-wrap justify-center gap-3">{actions}</div>}
    </div>
  );
}

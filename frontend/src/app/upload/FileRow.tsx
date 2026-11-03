// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function FileRow({
  number,
  name,
  muted = false,
  tone = "neutral",
  status,
  meta,
  action,
}: {
  number?: number | null;
  name: string;
  muted?: boolean;
  tone?: "neutral" | "destructive";
  status?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li
      className={cn(
        "upload-file-row flex min-h-12 items-center gap-3 rounded-md px-3 py-2 text-sm",
        tone === "destructive" ? "bg-destructive/10" : "hover:bg-raised",
      )}
    >
      {number !== undefined && (
        <span className="w-6 shrink-0 text-right text-faint tabular-nums">{number}</span>
      )}

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          title={name}
          className={cn("truncate font-medium", muted && "text-muted-foreground line-through")}
        >
          {name}
        </span>
        {status}
      </span>

      {meta && <span className="shrink-0 text-muted-foreground tabular-nums">{meta}</span>}
      {action}
    </li>
  );
}

export function FileList({ children }: { children: ReactNode }) {
  return <ul className="upload-file-list flex flex-col">{children}</ul>;
}

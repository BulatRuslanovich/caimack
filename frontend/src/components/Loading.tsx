// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/contexts/I18nContext";

const sizes = {
  s: { record: "1rem", frame: "py-1", arm: false },
  m: { record: "2.75rem", frame: "py-16", arm: true },
  l: { record: "4.5rem", frame: "h-dvh", arm: true },
} as const;

export function Loading({ size = "m", label }: { size?: keyof typeof sizes; label?: string }) {
  const t = useT();
  const { record, frame, arm } = sizes[size];

  return (
    <span role="status" className={cn("flex flex-col items-center justify-center gap-5", frame)}>
      <span
        aria-hidden="true"
        className="loading-record"
        data-arm={arm}
        style={{ "--loading-size": record } as CSSProperties}
      >
        <span className="loading-record-platter">
          <span className="loading-record-disc" />
          <span className="record-sheen" />
        </span>
        {arm && <span className="loading-record-arm" />}
      </span>

      {label ? (
        <span className="text-muted-foreground">{label}</span>
      ) : (
        <span className="sr-only">{t("common.loading")}</span>
      )}
    </span>
  );
}

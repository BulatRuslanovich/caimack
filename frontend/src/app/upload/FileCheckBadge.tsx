// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { ReactNode } from "react";
import type { FileCheck } from "@/lib/upload/uploadCheck";
import { cn } from "@/lib/cn";
import type { Track } from "@/lib/types";
import { useT } from "@/contexts/I18nContext";

const PARTIAL_COMPARISON = {
  None: "upload.notCompared",
  Tags: "upload.tagsOnly",
  Hash: "upload.hashOnly",
} as const;

export function FileCheckBadge({ check }: { check?: FileCheck }) {
  const t = useT();

  if (!check) return null;

  if (check.state === "failed") return <Note tone="warning">{t("upload.notChecked")}</Note>;

  if (check.verdict === "Duplicate")
    return (
      <Note tone="faint">
        {t("upload.duplicate")}
        <MatchedTrack track={check.match} />
      </Note>
    );

  if (check.verdict === "Upgrade")
    return (
      <Note tone="faint">
        {t("upload.upgrade")}
        <MatchedTrack track={check.match} />
      </Note>
    );

  if (check.basis === "HashAndTags") return null;

  return <Note tone="faint">{t(PARTIAL_COMPARISON[check.basis])}</Note>;
}

function Note({ tone, children }: { tone: "faint" | "warning"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-baseline gap-2 text-xs font-medium",
        tone === "faint" ? "text-faint" : "text-warning",
      )}
    >
      {children}
    </span>
  );
}

function MatchedTrack({ track }: { track: Track | null }) {
  if (!track) return null;

  return (
    <span className="min-w-0 truncate font-normal text-muted-foreground">
      {`${track.artistName} — ${track.title}`}
    </span>
  );
}

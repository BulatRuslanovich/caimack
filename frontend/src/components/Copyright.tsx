// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { cn } from "@/lib/cn";
import { useT } from "@/contexts/I18nContext";

const YEAR = 2026;

const HOLDER = "Bulat Ruslanovich";

export function Copyright({ className }: { className?: string }) {
  const t = useT();
  return (
    <p className={cn("text-2xs text-faint", className)}>
      © {YEAR} Caimack, {HOLDER}
      {" · "}
      <a
        href={process.env.APP_SOURCE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2"
      >
        {t("app.sourceCode")}
      </a>
      {" · AGPL-3.0"}
    </p>
  );
}

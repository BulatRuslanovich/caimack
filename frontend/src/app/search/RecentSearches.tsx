// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import Link from "next/link";
import { XIcon } from "lucide-react";
import { clearSearches, forgetSearch, useRecentSearches } from "@/lib/recentSearches";
import { Section } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useT } from "@/contexts/I18nContext";

export function RecentSearches() {
  const t = useT();
  const recent = useRecentSearches();

  if (recent.length === 0) return null;

  return (
    <Section
      title={t("search.recent")}
      actions={
        <Button variant="text" size="auto" className="text-sm" onClick={clearSearches}>
          {t("action.clear")}
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {recent.map((query) => (
          <span
            key={query}
            className="flex items-center rounded-full bg-raised text-sm font-medium text-muted-foreground transition-colors duration-150 ease-brand hover:bg-accent"
          >
            <Link
              href={`/search?q=${encodeURIComponent(query)}`}
              prefetch={false}
              className="max-w-[16rem] truncate rounded-full py-2 pl-4 hover:text-foreground hover:no-underline"
            >
              {query}
            </Link>
            <button
              type="button"
              onClick={() => forgetSearch(query)}
              aria-label={t("search.forget", { query })}
              className="grid size-9 place-items-center rounded-full text-faint hover:text-foreground"
            >
              <XIcon size={14} />
            </button>
          </span>
        ))}
      </div>
    </Section>
  );
}

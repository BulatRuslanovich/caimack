// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import Link from "next/link";
import { SearchIcon } from "lucide-react";
import { useT } from "@/contexts/I18nContext";
import { useYandexMusicSettings } from "@/lib/useYandexMusic";
import { SEARCH_MIN_LENGTH } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { YandexImportButton } from "./YandexImportButton";
import { YandexSearchResults } from "./YandexSearchResults";

export function YandexSearchWorkspace({ query }: { query: string }) {
  const t = useT();
  const settings = useYandexMusicSettings();
  const searching = query.length >= SEARCH_MIN_LENGTH;
  if (!settings.hasToken)
    return (
      <EmptyState
        icon={<SearchIcon size={24} />}
        title={t("yandex.connectTitle")}
        description={t("yandex.connectHint")}
        action={
          <Button asChild variant="primary">
            <Link href="/settings?tab=experimental">{t("yandex.connect")}</Link>
          </Button>
        }
      />
    );
  if (searching) return <YandexSearchResults query={query} />;
  return (
    <>
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-card p-5 max-md:p-4">
        <div className="max-w-xl space-y-1.5">
          <h2 className="text-section font-semibold">{t("yandex.searchTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("yandex.searchHint")}</p>
        </div>
        <YandexImportButton source={{ kind: "Likes", title: t("yandex.likes") }} />
      </section>
      <EmptyState
        bare
        icon={<SearchIcon size={24} />}
        title={t("yandex.searchEmpty")}
        description={t("yandex.searchEmptyHint")}
      />
    </>
  );
}

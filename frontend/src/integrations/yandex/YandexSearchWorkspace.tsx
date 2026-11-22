// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import Link from "next/link";
import { useT } from "@/contexts/I18nContext";
import { useYandexMusicSettings } from "./useYandexMusic";
import { SEARCH_MIN_LENGTH } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { YandexSearchResults } from "./YandexSearchResults";
import { ProviderAction } from "../ui";
import { YandexImportActivity } from "./YandexImports";
import { YandexPlaylistImport } from "./YandexPlaylistImport";

export function YandexSearchWorkspace({ query }: { query: string }) {
  const t = useT();
  const { hasToken } = useYandexMusicSettings();
  const searching = query.length >= SEARCH_MIN_LENGTH;
  return (
    <>
      <ProviderAction
        title={t(hasToken ? "yandex.playlist.title" : "yandex.connectTitle")}
        description={t(hasToken ? "yandex.playlist.summary" : "yandex.connectHint")}
      >
        {hasToken ? (
          <YandexPlaylistImport />
        ) : (
          <Button asChild size="sm">
            <Link href="/settings?tab=experimental">{t("yandex.connect")}</Link>
          </Button>
        )}
        <YandexImportActivity />
      </ProviderAction>
      {hasToken && searching && <YandexSearchResults query={query} />}
    </>
  );
}

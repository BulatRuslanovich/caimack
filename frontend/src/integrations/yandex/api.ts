// SPDX-License-Identifier: AGPL-3.0-only

import { queryOptions } from "@tanstack/react-query";
import { qs, request } from "@/lib/http";
import { SEARCH_MIN_LENGTH } from "@/lib/queries";
import type { YandexImport, YandexImportKind, YandexSearch } from "./types";
import { yandexMusicToken } from "./yandexMusic";

function yandexHeaders(): Record<string, string> {
  const token = yandexMusicToken();
  return token ? { "X-Yandex-Music-Token": token } : {};
}

export const yandexApi = {
  yandexSearch: (q: string, signal?: AbortSignal) =>
    request<YandexSearch>(`/integrations/yandex-music/search${qs({ q })}`, {
      signal,
      headers: yandexHeaders(),
    }),
  yandexImports: () => request<YandexImport[]>("/integrations/yandex-music/imports"),
  startYandexImport: (kind: YandexImportKind, id?: string) =>
    request<YandexImport>("/integrations/yandex-music/imports", {
      method: "POST",
      body: { kind, id },
      headers: yandexHeaders(),
    }),
  removeYandexImport: (id: string) =>
    request<void>(`/integrations/yandex-music/imports/${id}`, { method: "DELETE" }),
};

export const yandexQueries = {
  yandexSearch: (q: string) =>
    queryOptions({
      queryKey: ["yandexSearch", q],
      queryFn: ({ signal }) => yandexApi.yandexSearch(q, signal),
      enabled: q.length >= SEARCH_MIN_LENGTH,
      staleTime: 60_000,
    }),

  yandexImports: () =>
    queryOptions({
      queryKey: ["yandexImports"],
      queryFn: () => yandexApi.yandexImports(),
      refetchInterval: (query) =>
        query.state.data?.some((job) => job.status === "Queued" || job.status === "Running")
          ? 2000
          : false,
    }),
};

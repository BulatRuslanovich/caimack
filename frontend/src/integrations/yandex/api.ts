// SPDX-License-Identifier: AGPL-3.0-only

import { queryOptions } from "@tanstack/react-query";
import { request } from "@/lib/http";
import type { YandexImport, YandexImportKind } from "./types";
import { yandexMusicToken } from "./yandexMusic";

function yandexHeaders(): Record<string, string> {
  const token = yandexMusicToken();
  return token ? { "X-Yandex-Music-Token": token } : {};
}

export const yandexApi = {
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
  yandexImports: (userId: string) =>
    queryOptions({
      queryKey: ["yandexImports", userId],
      queryFn: () => yandexApi.yandexImports(),
      refetchInterval: (query) =>
        query.state.data?.some((job) => job.status === "Queued" || job.status === "Running")
          ? 2000
          : false,
    }),
};

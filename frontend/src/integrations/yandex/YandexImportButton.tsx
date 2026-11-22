// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { PlusIcon, RotateCcwIcon } from "lucide-react";
import {
  useYandexImports,
  isYandexImportActive,
  yandexSourceKey,
  type YandexSource,
} from "./YandexMusicContext";
import { useT } from "@/contexts/I18nContext";
import { ProviderImportButton } from "../ui";

export function YandexImportButton({
  source,
  inLibrary = false,
  unavailable = false,
}: {
  source: YandexSource & { kind: "Album" | "Track" };
  inLibrary?: boolean;
  unavailable?: boolean;
}) {
  const t = useT();
  const { jobs, sources, pending, errors, start } = useYandexImports();
  const key = yandexSourceKey(source);
  const job = jobs.find((each) => each.id === sources[key]?.jobId);
  const busy = pending.has(key) || (job && isYandexImportActive(job));
  const failed =
    Boolean(errors[key]) ||
    job?.status === "Failed" ||
    (job?.status === "Finished" && job.failures.length > 0);
  const done = inLibrary || (job?.status === "Finished" && !failed);
  const label = unavailable
    ? t("yandex.unavailable")
    : done
      ? t("yandex.inLibrary")
      : busy
        ? t("yandex.adding")
        : failed
          ? t("yandex.retry")
          : source.kind === "Album"
            ? t("yandex.addAlbum")
            : t("yandex.addTrack");
  const state = unavailable ? "unavailable" : done ? "done" : busy ? "busy" : "ready";

  return (
    <span className="flex max-w-full shrink-0 flex-col items-end gap-1">
      <ProviderImportButton
        icon={failed ? RotateCcwIcon : PlusIcon}
        label={label}
        state={state}
        compact={source.kind === "Track"}
        onClick={() => void start(source)}
        name={
          state === "ready" && !failed
            ? t("yandex.addNamed", { name: source.title })
            : `${source.title}: ${label}`
        }
      />
      {failed && !busy && (
        <details className="max-w-52 text-right text-xs text-destructive">
          <summary className="cursor-pointer">{t("yandex.addFailed")}</summary>
          <p className="mt-1 break-words text-muted-foreground">
            {errors[key] || job?.error || job?.failures[0]?.reason}
          </p>
        </details>
      )}
    </span>
  );
}

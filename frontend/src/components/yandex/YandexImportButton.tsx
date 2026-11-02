// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { CheckIcon, HeartIcon, LoaderCircleIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import {
  useYandexImports,
  isYandexImportActive,
  yandexSourceKey,
  type YandexSource,
} from "@/contexts/YandexMusicContext";
import { useT } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";

export function YandexImportButton({
  source,
  inLibrary = false,
  unavailable = false,
}: {
  source: YandexSource;
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
  const done = inLibrary || (source.kind !== "Likes" && job?.status === "Finished" && !failed);
  const label = unavailable
    ? t("yandex.unavailable")
    : done
      ? t("yandex.inLibrary")
      : busy
        ? t("yandex.adding")
        : failed
          ? t("yandex.retry")
          : source.kind === "Likes"
            ? t("yandex.importLikes")
            : source.kind === "Album"
              ? t("yandex.addAlbum")
              : t("yandex.addTrack");
  const Icon = done
    ? CheckIcon
    : busy
      ? LoaderCircleIcon
      : failed
        ? RotateCcwIcon
        : source.kind === "Likes"
          ? HeartIcon
          : PlusIcon;

  return (
    <span className="flex max-w-full shrink-0 flex-col items-end gap-1">
      <Button
        variant={done || busy || unavailable ? "ghost" : "outline"}
        size="sm"
        className="h-auto min-h-8 max-w-full py-1.5 whitespace-normal disabled:opacity-100 pointer-coarse:min-h-11"
        disabled={Boolean(busy) || done || unavailable}
        onClick={() => start(source)}
        aria-label={
          busy || done || unavailable
            ? `${source.title}: ${label}`
            : t("yandex.addNamed", { name: source.title })
        }
        aria-busy={Boolean(busy)}
      >
        {!unavailable && <Icon size={14} className={busy ? "animate-spin" : undefined} />}
        {label}
      </Button>
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

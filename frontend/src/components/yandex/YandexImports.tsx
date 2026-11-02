// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import Link from "next/link";
import {
  CheckIcon,
  DownloadIcon,
  LoaderCircleIcon,
  MusicIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { useYandexImports, isYandexImportActive } from "@/contexts/YandexMusicContext";
import type { YandexImport } from "@/lib/types";
import { useT } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";

export function YandexActivityButton({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const { jobs, setActivityOpen } = useYandexImports();
  const active = jobs.filter(isYandexImportActive).length;
  return (
    <Button
      variant={compact ? "ghost" : "outline"}
      size="sm"
      onClick={() => setActivityOpen(true)}
      className={compact ? "w-full justify-start px-3" : undefined}
    >
      {active > 0 ? (
        <LoaderCircleIcon size={15} className="animate-spin" />
      ) : (
        <DownloadIcon size={15} />
      )}
      {t("yandex.activity")}
      {active > 0 && (
        <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-xs text-primary tabular-nums">
          {active}
        </span>
      )}
    </Button>
  );
}

export function YandexImports() {
  const t = useT();
  const { jobs, loading, failed, refresh, activityOpen, setActivityOpen } = useYandexImports();
  const active = jobs.filter(isYandexImportActive);
  const completed = jobs.filter((job) => !isYandexImportActive(job));
  return (
    <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
      <DialogContent
        title={t("yandex.activityTitle")}
        description={t("yandex.activityHint")}
        className="w-[min(38rem,100%)]"
        footer={
          <Button asChild variant="outline">
            <Link href="/tracks" onClick={() => setActivityOpen(false)}>
              {t("yandex.openLibrary")}
            </Link>
          </Button>
        }
      >
        {loading ? (
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">
            {t("common.loading")}
          </p>
        ) : failed ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-destructive">{t("yandex.activityFailed")}</p>
            <Button size="sm" onClick={refresh}>
              {t("yandex.retry")}
            </Button>
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState
            bare
            icon={<DownloadIcon size={24} />}
            title={t("yandex.activityEmpty")}
            description={t("yandex.activityEmptyHint")}
          />
        ) : (
          <div className="flex flex-col gap-6">
            {active.length > 0 && (
              <section className="space-y-2" aria-label={t("yandex.adding")}>
                <h3 className="text-sm font-medium text-muted-foreground">{t("yandex.adding")}</h3>
                {active.map((job) => (
                  <ImportRow key={job.id} job={job} />
                ))}
              </section>
            )}
            {completed.length > 0 && (
              <section className="space-y-2" aria-label={t("yandex.recentActivity")}>
                <h3 className="text-sm font-medium text-muted-foreground">
                  {t("yandex.recentActivity")}
                </h3>
                {completed.map((job) => (
                  <ImportRow key={job.id} job={job} />
                ))}
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImportRow({ job }: { job: YandexImport }) {
  const t = useT();
  const { sources, remove, removing, start, pending } = useYandexImports();
  const source = Object.values(sources).find((each) => each.jobId === job.id);
  const active = isYandexImportActive(job);
  const failed = job.status === "Failed" || (job.status === "Finished" && job.failures.length > 0);
  const title =
    source?.title ?? (job.kind === "Likes" ? t("yandex.likes") : (job.title ?? t("yandex.title")));
  const summary =
    job.status === "Queued"
      ? t("yandex.preparing")
      : job.status === "Running"
        ? job.total > 1
          ? t("yandex.progress", { done: job.done, total: job.total })
          : t("yandex.adding")
        : job.status === "Cancelled"
          ? t("yandex.cancelled")
          : failed
            ? job.added > 0
              ? t("yandex.partial", { count: job.added })
              : t("yandex.addFailed")
            : job.added === 0 && job.skipped > 0
              ? t("yandex.inLibrary")
              : t("yandex.added", { count: job.added });
  return (
    <article className="rounded-md bg-card p-3">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-sm bg-raised text-muted-foreground">
          {source?.coverUrl ? (
            <img src={source.coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <MusicIcon size={20} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{title}</p>
          {source?.artist && (
            <p className="truncate text-xs text-muted-foreground">{source.artist}</p>
          )}
          <p
            role="status"
            className={`mt-1 flex items-center gap-1.5 text-xs ${failed ? "text-destructive" : "text-muted-foreground"}`}
          >
            {active ? (
              <LoaderCircleIcon size={12} className="shrink-0 animate-spin" />
            ) : !failed && job.status === "Finished" ? (
              <CheckIcon size={12} className="shrink-0" />
            ) : null}
            {summary}
          </p>
        </div>
        {(failed || job.status === "Cancelled") && source && (
          <Button
            variant="ghost"
            size="icon"
            disabled={pending.size > 0}
            onClick={() => start(source)}
            aria-label={t("yandex.retryNamed", { name: title })}
          >
            <RotateCcwIcon size={15} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          disabled={removing}
          onClick={() => remove(job.id)}
          aria-label={
            active
              ? t("yandex.stopNamed", { name: title })
              : t("yandex.dismissNamed", { name: title })
          }
        >
          <XIcon size={15} />
        </Button>
      </div>
      {active && job.total > 0 && (
        <div
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={job.total}
          aria-valuenow={job.done}
          className="mt-3 h-1 overflow-hidden rounded-full bg-border"
        >
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${Math.min(100, (job.done / job.total) * 100)}%` }}
          />
        </div>
      )}
      {active && job.current && job.total > 1 && (
        <p className="mt-2 truncate text-xs text-faint">{job.current}</p>
      )}
      {failed && (
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t("yandex.failureDetails")}</summary>
          <div className="mt-2 space-y-1 break-words">
            {job.error && <p>{job.error}</p>}
            {job.failures.map((failure, index) => (
              <p key={index}>
                {failure.title}: {failure.reason}
              </p>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}

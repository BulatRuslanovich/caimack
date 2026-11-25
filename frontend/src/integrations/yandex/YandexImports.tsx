// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import Link from "next/link";
import { Trigger as DialogTrigger } from "@radix-ui/react-dialog";
import { CheckIcon, DownloadIcon, LoaderCircleIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { useYandexImports, isYandexImportActive } from "./YandexMusicContext";
import type { YandexImport } from "./types";
import { useT } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import { ImportProgress, ProviderArtwork } from "../ui";

export function YandexImportActivity() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { jobs, loading, failed, refresh } = useYandexImports();
  const active = jobs.filter(isYandexImportActive);
  const completed = jobs.filter((job) => !isYandexImportActive(job));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {t("yandex.activity")}
          {active.length > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 text-xs text-primary tabular-nums">
              {active.length}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={t("yandex.activityTitle")}
        description={t("yandex.activityHint")}
        className="w-[min(38rem,100%)]"
        footer={
          <Button asChild variant="secondary">
            <Link href="/search?tab=tracks" onClick={() => setOpen(false)}>
              {t("action.browseTracks")}
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
                  <YandexImportRow key={job.id} job={job} />
                ))}
              </section>
            )}
            {completed.length > 0 && (
              <section className="space-y-2" aria-label={t("yandex.recentActivity")}>
                <h3 className="text-sm font-medium text-muted-foreground">
                  {t("yandex.recentActivity")}
                </h3>
                {completed.map((job) => (
                  <YandexImportRow key={job.id} job={job} />
                ))}
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function YandexImportRow({
  job,
  onRetry,
}: {
  job: YandexImport;
  onRetry?: (id: string) => void;
}) {
  const t = useT();
  const { sources, remove, removing, start, pending } = useYandexImports();
  const source = Object.values(sources).find((each) => each.jobId === job.id);
  const active = isYandexImportActive(job);
  const failed = job.status === "Failed" || (job.status === "Finished" && job.failures.length > 0);
  const title =
    job.kind === "Playlist"
      ? (job.title ?? t("yandex.playlist.import"))
      : (source?.title ??
        (job.kind === "Likes" ? t("yandex.likes") : (job.title ?? t("yandex.title"))));
  const summary =
    job.status === "Queued"
      ? t("yandex.preparing")
      : job.status === "Running"
        ? job.total > 1
          ? t("yandex.progress", { done: job.done, total: job.total })
          : t("yandex.adding")
        : job.status === "Cancelled"
          ? t("yandex.cancelled")
          : job.playlistId
            ? t("yandex.playlist.created")
            : failed
              ? job.added > 0
                ? t("yandex.partial", { count: job.added })
                : t("yandex.addFailed")
              : job.added === 0 && job.skipped > 0
                ? t("yandex.inLibrary")
                : t("yandex.added", { count: job.added });
  return (
    <article className="rounded-lg border border-border bg-card/60 p-3.5">
      <div className="flex items-start gap-3">
        <ProviderArtwork url={source?.coverUrl} className="size-10 shrink-0 rounded-md" />
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
              <LoaderCircleIcon
                size={12}
                className="shrink-0 motion-safe:animate-spin"
                aria-hidden
              />
            ) : !failed && job.status === "Finished" ? (
              <CheckIcon size={12} className="shrink-0 text-success" aria-hidden />
            ) : null}
            {summary}
          </p>
        </div>
        {!job.playlistId && (failed || job.status === "Cancelled") && source && (
          <Button
            variant="ghost"
            size="icon"
            disabled={pending.size > 0}
            onClick={() => {
              void start(source).then((next) => {
                if (next) onRetry?.(next.id);
              });
            }}
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
        <div className="mt-3">
          <ImportProgress value={job.done} total={job.total} label={title} />
        </div>
      )}
      {active && job.current && job.total > 1 && (
        <p className="mt-2 truncate text-xs text-faint">{job.current}</p>
      )}
      {job.playlistId && (
        <Button asChild size="sm" className="mt-3">
          <Link href={`/playlists/${job.playlistId}`}>{t("yandex.playlist.open")}</Link>
        </Button>
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

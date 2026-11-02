// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { XIcon } from "lucide-react";
import { fileKey, isDuplicate } from "@/lib/upload/uploadCheck";
import type { UploadProgress } from "@/lib/types";
import { queries } from "@/lib/queries";
import { useFormat } from "@/lib/useFormat";
import { useUpload } from "@/contexts/UploadContext";
import { cn } from "@/lib/cn";
import { TrackList } from "@/components/TrackList";
import { PageHeader, Section } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useT } from "@/contexts/I18nContext";
import { useYandexMusic } from "@/lib/useYandexMusic";
import { LibraryFolder } from "@/components/LibraryFolder";
import { BlankRecord, type BlankRecordState } from "./BlankRecord";
import { FileCheckBadge } from "./FileCheckBadge";
import { FileDrop } from "./FileDrop";
import { FileList, FileRow } from "./FileRow";

export default function UploadPage() {
  const t = useT();
  const format = useFormat();
  const stats = useQuery(queries.libraryOverview()).data?.stats;
  const yandex = useYandexMusic();

  const {
    queue,
    checks,
    pending,
    duplicates,
    progress,
    checking,
    uploaded,
    failed,
    add,
    remove,
    clearQueue,
    start,
    clearUploaded,
    clearFailed,
  } = useUpload();

  const totalSize = pending.reduce((sum, file) => sum + file.size, 0);
  const pendingNumber = new Map(pending.map((file, index) => [file, index + 1]));
  const uploading = progress !== null;

  const progressLabel = (current: UploadProgress) =>
    current.percent >= 100
      ? t("upload.readingTags")
      : current.fileCount > 1
        ? t("upload.uploadingFile", {
            index: current.fileIndex + 1,
            count: current.fileCount,
            progress: current.percent,
          })
        : t("upload.uploading", { progress: current.percent });

  return (
    <FileDrop
      onFiles={add}
      disabled={uploading}
      className="flex flex-1 flex-col gap-11 max-md:gap-8"
    >
      {({ dragging, choose, chooseFolder }) => {
        const recordState: BlankRecordState = uploading
          ? "uploading"
          : dragging
            ? "dragging"
            : queue.length > 0
              ? "ready"
              : "empty";

        return (
          <>
            <PageHeader
              title={t("nav.upload")}
              subtitle={
                stats && stats.freeBytes > 0
                  ? t("library.freeSpace", { size: format.bytes(stats.freeBytes) })
                  : undefined
              }
            />

            {yandex && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-card p-5">
                <div>
                  <h2 className="text-section font-semibold">{t("yandex.title")}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t("yandex.uploadHint")}</p>
                </div>
                <Button asChild size="sm">
                  <Link href="/search?tab=yandex">{t("yandex.findMusic")}</Link>
                </Button>
              </div>
            )}

            <section
              className={cn(
                "grid items-start gap-x-12 gap-y-8 rounded-lg bg-card p-8 max-md:p-5",
                "md:grid-cols-[auto_minmax(0,1fr)]",
                "outline-2 outline-offset-4 outline-transparent outline-dashed",
                "transition-[outline-color] duration-150 ease-brand",
                dragging && "outline-primary",
              )}
            >
              <div className="flex flex-col items-start gap-6 md:sticky md:top-8">
                <div
                  role={uploading ? "progressbar" : undefined}
                  aria-valuemin={uploading ? 0 : undefined}
                  aria-valuemax={uploading ? 100 : undefined}
                  aria-valuenow={progress?.percent}
                  aria-valuetext={progress ? progressLabel(progress) : undefined}
                >
                  <BlankRecord state={recordState} played={progress?.percent ?? 0} />
                </div>

                {queue.length > 0 &&
                  (progress ? (
                    <p aria-hidden="true" className="text-sm font-medium tabular-nums">
                      {progressLabel(progress)}
                    </p>
                  ) : (
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={start}
                      disabled={checking > 0 || pending.length === 0}
                    >
                      {checking > 0
                        ? t("upload.checking")
                        : pending.length === 0
                          ? t("upload.nothingToUpload")
                          : t("upload.submit", { count: pending.length })}
                    </Button>
                  ))}
              </div>

              {queue.length === 0 ? (
                <div className="flex flex-col items-start gap-5 self-center">
                  <h2 className="text-title font-semibold text-balance">
                    {dragging ? t("upload.dropRelease") : t("upload.dropHint")}
                  </h2>
                  <div className="flex flex-wrap gap-3">
                    <Button variant="primary" onClick={choose}>
                      {t("upload.chooseFiles")}
                    </Button>
                    <Button variant="outline" onClick={chooseFolder} className="max-md:hidden">
                      {t("upload.chooseFolder")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex min-w-0 flex-col gap-4">
                  <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                    <div className="min-w-0">
                      <h2 className="text-section font-semibold">
                        {dragging
                          ? t("upload.dropRelease")
                          : t("upload.ready", { count: pending.length })}
                      </h2>
                      <p className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
                        <span>{format.bytes(totalSize)}</span>
                        {duplicates.length > 0 && (
                          <span>{t("upload.skipped", { count: duplicates.length })}</span>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-5">
                      <Button variant="text" size="auto" onClick={choose} disabled={uploading}>
                        {t("upload.addMore")}
                      </Button>
                      <Button
                        variant="text"
                        size="auto"
                        onClick={chooseFolder}
                        disabled={uploading}
                        className="max-md:hidden"
                      >
                        {t("upload.addFolder")}
                      </Button>
                      <Button variant="text" size="auto" onClick={clearQueue} disabled={uploading}>
                        {t("action.clear")}
                      </Button>
                    </div>
                  </div>

                  <FileList>
                    {queue.map((file, index) => {
                      const check = checks[fileKey(file)];
                      const skipped = isDuplicate(check);

                      return (
                        <FileRow
                          key={`${file.name}-${file.size}-${index}`}
                          number={skipped ? null : (pendingNumber.get(file) ?? null)}
                          name={file.name}
                          muted={skipped}
                          status={<FileCheckBadge check={check} />}
                          meta={format.bytes(file.size)}
                          action={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              disabled={uploading}
                              onClick={() => remove(index)}
                              aria-label={t("upload.removeNamed", { fileName: file.name })}
                            >
                              <XIcon size={16} />
                            </Button>
                          }
                        />
                      );
                    })}
                  </FileList>
                </div>
              )}
            </section>

            <LibraryFolder />

            {failed.length > 0 && (
              <Section
                title={t("upload.notAdded")}
                actions={
                  <Button variant="text" size="auto" onClick={clearFailed}>
                    {t("action.clear")}
                  </Button>
                }
              >
                <FileList>
                  {failed.map((failure, index) => (
                    <FileRow
                      key={`${failure.fileName}-${index}`}
                      name={failure.fileName}
                      tone="destructive"
                      status={
                        <span className="text-xs font-medium text-destructive">
                          {failure.reason}
                        </span>
                      }
                    />
                  ))}
                </FileList>
              </Section>
            )}

            {uploaded.length > 0 && (
              <Section
                title={t("upload.justAdded")}
                actions={
                  <>
                    <Button variant="text" size="auto" onClick={clearUploaded}>
                      {t("action.clear")}
                    </Button>
                    <Button variant="text" size="auto" asChild>
                      <Link href="/tracks">{t("upload.goToLibrary")}</Link>
                    </Button>
                  </>
                }
              >
                <TrackList tracks={uploaded} onChanged={clearUploaded} />
              </Section>
            )}
          </>
        );
      }}
    </FileDrop>
  );
}

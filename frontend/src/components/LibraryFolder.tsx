// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { RefreshCwIcon } from "lucide-react";
import { api } from "@/lib/api";
import { queries } from "@/lib/queries";
import { useFormat } from "@/lib/useFormat";
import { useInvalidate } from "@/lib/useInvalidate";
import { FileList, FileRow } from "@/app/upload/FileRow";
import { Section } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useT } from "@/contexts/I18nContext";

export function LibraryFolder() {
  const t = useT();
  const format = useFormat();
  const invalidate = useInvalidate();
  const scan = useQuery(queries.libraryScan());
  const rescan = useMutation({
    mutationFn: () => api.rescanLibrary(),
    onSuccess: () => void scan.refetch(),
  });

  const status = scan.data;
  const changes = status ? status.added + status.moved + status.updated + status.removed : 0;
  const lastChanges = useRef(changes);
  useEffect(() => {
    if (changes > lastChanges.current) invalidate("library");
    lastChanges.current = changes;
  }, [changes, invalidate]);

  if (!status?.configured) return null;

  const running = status.running || rescan.isPending;
  const counts = [
    [status.added, "library.scan.added"],
    [status.moved, "library.scan.moved"],
    [status.updated, "library.scan.updated"],
    [status.skipped, "library.scan.skipped"],
    [status.failed, "library.scan.failed"],
    [status.missing, "library.scan.missing"],
    [status.removed, "library.scan.removed"],
    [status.unsupported, "library.scan.unsupported"],
  ] as const;

  return (
    <Section
      className="workspace-panel upload-library-folder p-5 max-md:p-4"
      title={t("library.folder")}
      actions={
        <Button variant="outline" size="sm" disabled={running} onClick={() => rescan.mutate()}>
          <RefreshCwIcon size={14} className={running ? "animate-spin" : undefined} />
          {running ? t("library.scanning") : t("library.rescan")}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground tabular-nums">
        {status.running
          ? t("library.scan.progress", { checked: status.checked, files: status.files })
          : status.finishedAt
            ? [
                t("library.scan.files", { count: status.files }),
                ...counts
                  .filter(([value]) => value > 0)
                  .map(([value, phrase]) => t(phrase, { count: value })),
                format.playedAt(status.finishedAt),
              ].join(" · ")
            : t("library.scan.never")}
      </p>

      {status.problems.length > 0 && (
        <FileList>
          {status.problems.map((problem, index) => (
            <FileRow
              key={`${problem.path}-${index}`}
              name={problem.path || t("library.folder")}
              tone="destructive"
              status={
                <span className="text-xs font-medium text-destructive">{problem.reason}</span>
              }
            />
          ))}
        </FileList>
      )}
    </Section>
  );
}

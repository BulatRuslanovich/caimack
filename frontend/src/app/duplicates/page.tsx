// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatArtists, formatAudioSpec, formatDuration, isLossless } from "@/lib/format";
import { queries } from "@/lib/queries";
import { useInvalidate } from "@/lib/useInvalidate";
import { useToast } from "@/lib/useToast";
import type { DuplicateGroup, Track } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Query } from "@/components/Query";
import { TrackCover } from "@/components/Cover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/alert-dialog";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { CopyIcon, PlayIcon, SplitIcon } from "lucide-react";

export default function DuplicatesPage() {
  const t = useT();
  const report = useQuery(queries.duplicates());

  const subtitle =
    report.data && report.data.comparedTracks < report.data.totalTracks
      ? t("duplicates.coverage", {
          compared: report.data.comparedTracks,
          total: report.data.totalTracks,
        })
      : undefined;

  return (
    <>
      <PageHeader title={t("duplicates.title")} subtitle={subtitle} />

      <Query
        result={report}
        isEmpty={(data) => data.groups.length === 0}
        empty={{ icon: <CopyIcon size={24} />, title: t("duplicates.empty") }}
      >
        {(data) => (
          <ul className="flex flex-col gap-4">
            {data.groups.map((group) => (
              <DuplicateCard key={group.tracks.map((track) => track.id).join(":")} group={group} />
            ))}
          </ul>
        )}
      </Query>
    </>
  );
}

function DuplicateCard({ group }: { group: DuplicateGroup }) {
  const t = useT();
  const { playTrack } = usePlayerActions();
  const { notify, notifyError } = useToast();
  const invalidate = useInvalidate();
  const [confirm, confirmDialog] = useConfirm();

  const ids = group.tracks.map((track) => track.id);

  const done = (message: string) => {
    notify(message, "success");
    invalidate("library");
  };

  const merge = useMutation({
    mutationFn: (keep: Track) =>
      api.mergeDuplicates(
        keep.id,
        ids.filter((id) => id !== keep.id),
      ),
    onSuccess: () => done(t("duplicates.merged")),
    onError: (error) => notifyError(error),
  });

  const dismiss = useMutation({
    mutationFn: () => api.dismissDuplicates(ids),
    onSuccess: () => done(t("duplicates.dismissed")),
    onError: (error) => notifyError(error),
  });

  const busy = merge.isPending || dismiss.isPending;

  const askToKeep = (track: Track) =>
    confirm({
      title: t("duplicates.keepTitle", { title: track.title }),
      description: t("duplicates.keepDescription", { count: ids.length - 1 }),
      confirmLabel: t("duplicates.keep"),
      destructive: true,
      action: () => merge.mutate(track),
    });

  return (
    <li className="flex flex-col gap-3 rounded-lg bg-card p-4" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {group.similarity == null
            ? t("duplicates.sameTags")
            : t("duplicates.similarity", { percent: Math.floor(group.similarity * 100) })}
        </span>

        <Button variant="text" size="sm" disabled={busy} onClick={() => dismiss.mutate()}>
          <SplitIcon size={14} /> {t("duplicates.dismiss")}
        </Button>
      </div>

      <ul className="flex flex-col divide-y divide-border">
        {group.tracks.map((track, index) => {
          const spec = formatAudioSpec(track);

          return (
            <li key={track.id} className="flex items-center gap-3 py-2.5 max-sm:flex-wrap">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => playTrack(track, group.tracks)}
                aria-label={t("action.playNamed", { name: track.title })}
                className="shrink-0"
              >
                <PlayIcon size={16} />
              </Button>

              <TrackCover track={track} size="2.75rem" className="shrink-0 rounded-sm" />

              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{track.title}</span>
                <span className="truncate text-sm text-muted-foreground">
                  {[formatArtists(track), track.albumTitle].filter(Boolean).join(" — ")}
                </span>
                <span className="truncate text-xs text-faint">{track.originalFileName}</span>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground tabular-nums max-sm:ml-14 max-sm:flex-row max-sm:items-center max-sm:gap-2">
                {index === 0 && <span className="text-primary">{t("duplicates.best")}</span>}
                {spec && (isLossless(track.codec) ? <Badge>{spec}</Badge> : <span>{spec}</span>)}
                <span>{formatDuration(track.durationSeconds)}</span>
              </div>

              <div className="flex shrink-0 justify-end">
                <Button
                  variant={index === 0 ? "primary" : "outline"}
                  size="sm"
                  disabled={busy}
                  onClick={() => askToKeep(track)}
                >
                  {t("duplicates.keep")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      {confirmDialog}
    </li>
  );
}

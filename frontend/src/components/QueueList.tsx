// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useT } from "@/contexts/I18nContext";
import { usePlayer } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatArtists, formatDuration } from "@/lib/format";
import { reasonLabel } from "@/lib/recommendationReason";
import type { QueueSignals, RadioFocus, RecommendationReason, Track } from "@/lib/types";
import { useInvalidate } from "@/lib/useInvalidate";
import { useRecommendations } from "@/lib/useRecommendations";
import { useToast } from "@/lib/useToast";
import { type DragEndEvent } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRightIcon, ListMusicIcon, ListVideoIcon, Trash2Icon } from "lucide-react";
import dynamic from "next/dynamic";
import { memo, useCallback, useState } from "react";
import { TrackCover } from "./Cover";
import { EmptyState } from "./EmptyState";
import { NowPlayingBars } from "./PlaybackIndicators";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { ToggleGroup, ToggleGroupButton } from "./ui/toggle-group";
import { DragHandle, VerticalSortable } from "./VerticalSortable";

import { queueEntryKey } from "@/lib/playback/queueEntries";
import { QueueViewport } from "./QueueViewport";

const RADIO_FOCUSES: RadioFocus[] = ["closer", "balanced", "wider"];
const PlaylistDialog = dynamic(() => import("./PlaylistDialog").then((m) => m.PlaylistDialog));

export function QueueList() {
  const recommendations = useRecommendations();
  const player = usePlayer();
  const t = useT();
  const { notify } = useToast();
  const invalidate = useInvalidate();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const { snapshotQueue, removeFromQueue, restoreQueue } = player;
  const remove = useCallback(
    (index: number, track: Track) => {
      const snapshot = snapshotQueue();
      removeFromQueue(index);
      notify(t("queue.removed", { title: track.title }), "info", {
        label: t("action.undo"),
        run: () => restoreQueue(snapshot),
      });
    },
    [snapshotQueue, removeFromQueue, restoreQueue, notify, t],
  );

  if (player.queue.length === 0) {
    return <EmptyState bare icon={<ListVideoIcon size={24} />} title={t("queue.empty")} />;
  }

  const radioNote =
    player.radio === "loading"
      ? t("queue.radioLoading")
      : player.radio === "empty"
        ? t("queue.radioEmpty")
        : player.radio === "failed"
          ? t("queue.radioFailed")
          : null;

  const undoable = (message: string, snapshot: ReturnType<typeof player.snapshotQueue>) => {
    notify(message, "info", { label: t("action.undo"), run: () => player.restoreQueue(snapshot) });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = player.queue.findIndex((track) => queueEntryKey(track) === active.id);
    const to = player.queue.findIndex((track) => queueEntryKey(track) === over.id);
    if (from < 0 || to < 0) return;

    player.moveInQueue(from, to);
  };

  const radioFrom = player.snapshotQueue().radioFrom;
  const radioStart = Math.max(radioFrom, player.currentIndex + 1);
  const played = Math.max(player.currentIndex, 0);
  const firstShown = showHistory ? 0 : played;
  const seedTitle = player.queue.find(
    (track) => track.id === player.radioSession?.seedTrackId,
  )?.title;
  const radioLabel = seedTitle ? t("queue.radioFrom", { title: seedTitle }) : t("queue.similar");

  const saveAsPlaylist = async (playlistId: string) => {
    try {
      await api.addToPlaylist(
        playlistId,
        player.queue.map((track) => track.id),
      );
    } finally {
      invalidate("playlists");
    }
  };

  return (
    <>
      <div className="mb-1.5 flex items-center justify-between gap-2 px-0.5 pt-1 pb-2.5">
        <span className="min-w-0 truncate text-sm text-muted-foreground">
          {t("count.tracks", { count: player.queue.length })}
        </span>

        <div className="flex items-center gap-3">
          <SaveQueueButton onSave={saveAsPlaylist} />

          <Button
            variant="text"
            size="auto"
            className="text-sm"
            onClick={() => {
              const snapshot = player.snapshotQueue();
              player.clearQueue();
              undoable(t("queue.cleared"), snapshot);
            }}
          >
            {t("action.clear")}
          </Button>
        </div>
      </div>

      {recommendations && (
        <label className="mb-2 flex items-center justify-between gap-3 px-0.5 text-sm text-muted-foreground">
          {t("queue.autoplay")}
          <Switch checked={player.autoplay} onCheckedChange={player.setAutoplay} />
        </label>
      )}

      {recommendations && player.radioSession && (
        <ToggleGroup aria-label={t("radio.focus")} className="mb-2 gap-x-4 px-0.5">
          {RADIO_FOCUSES.map((focus) => (
            <ToggleGroupButton
              key={focus}
              active={(player.radioSession?.focus ?? "balanced") === focus}
              onClick={() => player.setRadioFocus(focus)}
            >
              {t(`radio.focus.${focus}`)}
            </ToggleGroupButton>
          ))}
        </ToggleGroup>
      )}

      {played > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowHistory((shown) => !shown)}
            aria-expanded={showHistory}
            className="flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronRightIcon
              size={14}
              className={cn("transition-transform", showHistory && "rotate-90")}
            />
            {t("queue.history", { count: played })}
          </button>
        </div>
      )}

      <VerticalSortable
        constrainToScroll
        items={player.queue.slice(firstShown).map(queueEntryKey)}
        onDragEnd={onDragEnd}
        onActiveChange={setActiveId}
      >
        <QueueViewport
          activeId={activeId}
          initialIndex={Math.max(0, player.currentIndex - firstShown)}
          rows={player.queue.slice(firstShown).map((track, offset) => {
            const index = firstShown + offset;

            return {
              key: queueEntryKey(track),
              content: (
                <QueueRow
                  key={queueEntryKey(track)}
                  track={track}
                  index={index}
                  isCurrent={index === player.currentIndex}
                  isPlaying={index === player.currentIndex && player.isPlaying}
                  section={
                    index === radioStart && radioStart < player.queue.length
                      ? radioLabel
                      : index === player.currentIndex + 1 && player.currentIndex >= 0
                        ? t("queue.upNext")
                        : undefined
                  }
                  reason={
                    index === player.currentIndex || index === player.currentIndex + 1
                      ? player.radioSession?.reasons[track.id]
                      : undefined
                  }
                  signals={player.radioSession?.signals?.[track.id]}
                  onPlay={player.jumpTo}
                  onRemove={remove}
                />
              ),
            };
          })}
        />
      </VerticalSortable>

      {radioNote && (
        <p
          role="status"
          className={cn(
            "p-3 text-center text-sm",
            player.radio === "loading" ? "text-primary" : "text-muted-foreground",
          )}
        >
          {radioNote}
        </p>
      )}
    </>
  );
}

function SaveQueueButton({ onSave }: { onSave: (playlistId: string) => Promise<void> }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label={t("queue.saveAsPlaylist")}
        title={t("queue.saveAsPlaylist")}
      >
        <ListMusicIcon size={16} />
      </Button>

      {open && (
        <PlaylistDialog
          onClose={() => setOpen(false)}
          afterCreate={onSave}
          successMessage={t("queue.savedAsPlaylist")}
        />
      )}
    </>
  );
}

const QueueRow = memo(function QueueRow({
  track,
  index,
  isCurrent,
  isPlaying,
  section,
  reason,
  signals,
  onPlay,
  onRemove,
}: {
  track: Track;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  section?: string;
  reason?: RecommendationReason;
  signals?: QueueSignals;
  onPlay: (index: number) => void;
  onRemove: (index: number, track: Track) => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: queueEntryKey(track),
  });

  return (
    <>
      {section && (
        <div aria-hidden="true" className="px-1.5 pt-2 pb-1 text-xs text-muted-foreground">
          {section}
        </div>
      )}

      <div
        ref={setNodeRef}
        data-current={isCurrent ? "true" : undefined}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cn(
          "queue-row group flex items-center gap-1 rounded-md hover:bg-card",
          isDragging && "z-10 opacity-90 shadow-pop",
        )}
      >
        <DragHandle
          {...attributes}
          {...listeners}
          aria-label={t("tracks.reorderNamed", { title: track.title })}
          className="ml-1"
        />

        <button
          type="button"
          onClick={() => onPlay(index)}
          aria-current={isCurrent}
          className="flex min-w-0 flex-1 items-center gap-2.5 p-1.5 text-left"
        >
          <span className="relative shrink-0">
            <TrackCover track={track} size={36} />
            {isPlaying && (
              <span className="absolute inset-0 grid place-items-center rounded-xs bg-black/55 text-white">
                <NowPlayingBars />
              </span>
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold">{track.title}</span>
            <span className="library-secondary truncate text-[0.8125rem] leading-5">
              {formatArtists(track)}
            </span>
            {reason && (
              <span className="library-tertiary flex min-w-0 items-center gap-1.5 text-xs">
                {signals?.explore && (
                  <span className="shrink-0 rounded-full bg-raised px-1.5 py-px font-medium text-primary">
                    {t("queue.explore")}
                  </span>
                )}
                <span className="truncate">{reasonLabel(reason, t)}</span>
              </span>
            )}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDuration(track.durationSeconds)}
          </span>
        </button>

        <Button
          variant="ghost"
          size="icon-sm"
          className="mr-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
          onClick={() => onRemove(index, track)}
          aria-label={t("queue.removeNamed", { title: track.title })}
        >
          <Trash2Icon size={16} />
        </Button>
      </div>
    </>
  );
});

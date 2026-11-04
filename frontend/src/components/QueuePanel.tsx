// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import dynamic from "next/dynamic";
import { type DragEndEvent } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatArtists, formatDuration } from "@/lib/format";
import type { QueueSignals, RadioFocus, RecommendationReason, Track } from "@/lib/types";
import { usePlayer } from "@/contexts/PlayerContext";
import { usePlayerUi } from "@/contexts/PlayerUiContext";
import { useT } from "@/contexts/I18nContext";
import { useInvalidate } from "@/lib/useInvalidate";
import { useToast } from "@/lib/useToast";
import { moodLabel } from "@/lib/moods";
import { reasonLabel } from "@/lib/recommendationReason";
import { TrackCover } from "./Cover";
import { EmptyState } from "./EmptyState";
import { NowPlayingBars } from "./PlaybackIndicators";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { ToggleGroup, ToggleGroupButton } from "./ui/toggle-group";
import { DragHandle, VerticalSortable } from "./VerticalSortable";
import {
  ChevronRightIcon,
  ListMusicIcon,
  ListVideoIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

const RADIO_FOCUSES: RadioFocus[] = ["closer", "balanced", "wider"];

const PlaylistDialog = dynamic(() => import("./PlaylistDialog").then((m) => m.PlaylistDialog));

const SORTABLE_PREFIX = "queue-";

export function QueuePanel({ onClose, docked = false }: { onClose: () => void; docked?: boolean }) {
  const t = useT();
  const { queuePinned, setQueuePinned } = usePlayerUi();

  useEffect(() => {
    if (docked) return;
    const close = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')
      )
        onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [docked, onClose]);

  return (
    <aside
      aria-label={t("queue.label")}
      data-queue-panel={docked ? "docked" : "floating"}
      className={cn(
        "queue-panel flex min-h-0 min-w-0 flex-col p-3.5",
        docked
          ? "queue-panel-docked border-l border-border [grid-area:queue]"
          : "fixed right-4 bottom-[calc(var(--player-height)+0.75rem)] z-50 max-h-[min(60vh,32.5rem)] w-[min(22.5rem,calc(100vw-2rem))] rounded-lg bg-popover shadow-pop animate-in duration-200 fade-in-0 slide-in-from-bottom-3 max-md:inset-x-3 max-md:bottom-[calc(var(--player-height)+var(--mobile-nav-height)+env(safe-area-inset-bottom)+0.625rem)] max-md:max-h-[min(52dvh,26rem)] max-md:w-auto",
      )}
    >
      <header className="mb-2 flex shrink-0 items-center justify-between">
        <h3 className="text-section font-semibold">{t("queue.title")}</h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="max-xl:hidden"
            onClick={() => setQueuePinned(!queuePinned)}
            aria-label={queuePinned ? t("queue.unpin") : t("queue.pin")}
            title={queuePinned ? t("queue.unpin") : t("queue.pin")}
            aria-pressed={queuePinned}
          >
            {queuePinned ? <PinOffIcon size={16} /> : <PinIcon size={16} />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("queue.close")}>
            <XIcon size={16} />
          </Button>
        </div>
      </header>

      <QueueList />
    </aside>
  );
}

export function QueueList() {
  const player = usePlayer();
  const t = useT();
  const { notify } = useToast();
  const invalidate = useInvalidate();
  const listRef = useRef<HTMLOListElement>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    listRef.current?.querySelector("[data-current]")?.scrollIntoView({ block: "center" });
  }, []);

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

    const from = Number(String(active.id).slice(SORTABLE_PREFIX.length));
    const to = Number(String(over.id).slice(SORTABLE_PREFIX.length));
    if (Number.isNaN(from) || Number.isNaN(to)) return;

    player.moveInQueue(from, to);
  };

  const radioFrom = player.snapshotQueue().radioFrom;
  const radioStart = Math.max(radioFrom, player.currentIndex + 1);
  const played = Math.max(player.currentIndex, 0);
  const firstShown = showHistory ? 0 : played;
  const seedTitle = player.queue.find(
    (track) => track.id === player.radioSession?.seedTrackId,
  )?.title;
  const radioMood = player.radioSession?.mood;
  const radioLabel = radioMood
    ? t("queue.radioMood", { mood: moodLabel(radioMood, t) })
    : seedTitle
      ? t("queue.radioFrom", { title: seedTitle })
      : t("queue.similar");

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

      <label className="mb-2 flex items-center justify-between gap-3 px-0.5 text-sm text-muted-foreground">
        {t("queue.autoplay")}
        <Switch checked={player.autoplay} onCheckedChange={player.setAutoplay} />
      </label>

      {player.radioSession && !radioMood && (
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

      <VerticalSortable
        items={player.queue
          .slice(firstShown)
          .map((_, offset) => `${SORTABLE_PREFIX}${firstShown + offset}`)}
        onDragEnd={onDragEnd}
      >
        <ol ref={listRef} className="flex flex-col gap-0.5 overflow-y-auto">
          {played > 0 && (
            <li>
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
            </li>
          )}

          {player.queue.slice(firstShown).map((track, offset) => {
            const index = firstShown + offset;

            return (
              <QueueRow
                key={`${track.id}-${index}`}
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
                onPlay={() => player.jumpTo(index)}
                onRemove={() => {
                  const snapshot = player.snapshotQueue();
                  player.removeFromQueue(index);
                  undoable(t("queue.removed", { title: track.title }), snapshot);
                }}
              />
            );
          })}
        </ol>
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

function QueueRow({
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
  onPlay: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${SORTABLE_PREFIX}${index}`,
  });

  return (
    <>
      {section && (
        <li aria-hidden="true" className="px-1.5 pt-2 pb-1 text-xs text-muted-foreground">
          {section}
        </li>
      )}

      <li
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
          onClick={onPlay}
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
          onClick={onRemove}
          aria-label={t("queue.removeNamed", { title: track.title })}
        >
          <Trash2Icon size={16} />
        </Button>
      </li>
    </>
  );
}

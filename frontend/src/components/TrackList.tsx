// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { smoothUnlessReduced } from "@/lib/scroll";
import { formatAudioSpec, formatDuration, isLossless } from "@/lib/format";
import { keyName } from "@/lib/musicalKey";
import { useFormat } from "@/lib/useFormat";
import { useToggleFavorite } from "@/lib/useToggleFavorite";
import type { Track } from "@/lib/types";
import { useNowPlaying, usePlayerActions } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { ArtistLinks } from "./ArtistLinks";
import { TrackCover } from "./Cover";
import { EmptyState } from "./EmptyState";
import { NowPlayingBars } from "./PlaybackIndicators";
import { TrackMenu } from "./TrackMenu";
import { DragHandle, VerticalSortable } from "./VerticalSortable";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Caption } from "./ui/caption";
import { EllipsisVerticalIcon, HeartIcon, MusicIcon, PauseIcon, PlayIcon } from "lucide-react";

interface TrackSelection {
  selected: ReadonlySet<string>;
  onToggle: (trackId: string, index: number, extend: boolean) => void;
  onToggleAll: () => void;
}

interface TrackListProps {
  tracks: Track[];
  showCover?: boolean;
  showAlbum?: boolean;
  showArtist?: boolean;
  showAudioSpec?: boolean;
  showTempoKey?: boolean;
  useTrackNumbers?: boolean;
  playedAt?: Record<string, string>;
  onChanged?: () => void;
  playlistId?: string;
  onReorder?: (trackIds: string[]) => void;
  emptyMessage?: string;
  selection?: TrackSelection;
}

const ROW_COLUMNS = {
  "album+date": "grid-cols-[2.75rem_minmax(0,3fr)_minmax(0,2fr)_7rem_4.75rem_5.5rem]",
  album: "grid-cols-[2.75rem_minmax(0,3fr)_minmax(0,2fr)_4.75rem_5.5rem]",
  date: "grid-cols-[2.75rem_minmax(0,3fr)_7rem_4.75rem_5.5rem]",
  plain: "grid-cols-[2.75rem_minmax(0,1fr)_4.75rem_5.5rem]",
  "album+date+tempo": "grid-cols-[2.75rem_minmax(0,3fr)_minmax(0,2fr)_7rem_6.5rem_4.75rem_5.5rem]",
  "album+tempo": "grid-cols-[2.75rem_minmax(0,3fr)_minmax(0,2fr)_6.5rem_4.75rem_5.5rem]",
  "date+tempo": "grid-cols-[2.75rem_minmax(0,3fr)_7rem_6.5rem_4.75rem_5.5rem]",
  tempo: "grid-cols-[2.75rem_minmax(0,1fr)_6.5rem_4.75rem_5.5rem]",
} as const;

const revealOnRow =
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100 [@media(hover:none)]:opacity-100";

const rowBase =
  "grid items-center gap-3 rounded-md px-2.5 py-2 max-md:grid-cols-[2.125rem_minmax(0,1fr)_auto_auto] max-md:gap-2 max-md:px-1 max-[380px]:grid-cols-[2.125rem_minmax(0,1fr)_auto]";

function rowGridFor(showAlbum: boolean, showDate: boolean, showTempoKey: boolean): string {
  const parts = [showAlbum && "album", showDate && "date", showTempoKey && "tempo"].filter(Boolean);
  const key = (parts.join("+") || "plain") as keyof typeof ROW_COLUMNS;
  return cn(rowBase, ROW_COLUMNS[key]);
}

export function TrackList({
  tracks,
  showCover = true,
  showAlbum = true,
  showArtist = true,
  showAudioSpec = true,
  showTempoKey = false,
  useTrackNumbers = false,
  playedAt,
  onChanged,
  playlistId,
  onReorder,
  emptyMessage,
  selection,
}: TrackListProps) {
  const { currentTrackId, isPlaying } = useNowPlaying();
  const actions = usePlayerActions();
  const t = useT();

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [focused, setFocused] = useState(0);
  const [currentVisible, setCurrentVisible] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});

  const [renderedTracks, setRenderedTracks] = useState(tracks);
  if (tracks !== renderedTracks) {
    setRenderedTracks(tracks);
    setFavorites({});
  }

  const isFavorite = useCallback(
    (track: Track) => favorites[track.id] ?? track.isFavorite,
    [favorites],
  );

  const toggleFavorite = useToggleFavorite();

  const likeTrack = useCallback(
    (track: Track, current: boolean) => {
      void toggleFavorite({ id: track.id, isFavorite: current }, (next) =>
        setFavorites((all) => ({ ...all, [track.id]: next })),
      );
    },
    [toggleFavorite],
  );

  const openMenuFor = useCallback(
    (trackId: string, open: boolean) => setMenuFor(open ? trackId : null),
    [],
  );

  const currentTrackIdRef = useRef(currentTrackId);
  useLayoutEffect(() => {
    currentTrackIdRef.current = currentTrackId;
  });

  const play = useCallback(
    (index: number) => {
      const track = tracks[index];
      if (!track) return;

      if (currentTrackIdRef.current === track.id) {
        actions.toggle();
        return;
      }
      actions.playQueue(tracks, index);
    },
    [actions, tracks],
  );

  const focusRow = (index: number) => {
    const clamped = Math.max(0, Math.min(index, tracks.length - 1));
    setFocused(clamped);
    bodyRef.current?.querySelector<HTMLElement>(`[data-row="${clamped}"]`)?.focus();
    return clamped;
  };

  const onRowsKeyDown = (event: React.KeyboardEvent) => {
    const from = Number((event.target as HTMLElement).dataset.row);
    if (Number.isNaN(from)) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const to = focusRow(from + (event.key === "ArrowDown" ? 1 : -1));

      if (event.shiftKey && selection && to !== from) {
        selection.onToggle(tracks[to].id, to, true);
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      play(from);
    }
  };

  const sortable = Boolean(playlistId && onReorder);

  const playlistTrackIds = useMemo(
    () => (playlistId ? tracks.map((item) => item.id) : undefined),
    [playlistId, tracks],
  );

  const selectable = selection !== undefined;
  const onToggleSelected = selection?.onToggle;

  const playingIndex = currentTrackId
    ? tracks.findIndex((track) => track.id === currentTrackId)
    : -1;

  useEffect(() => {
    const row = bodyRef.current?.querySelector(`[data-row="${playingIndex}"]`);
    if (playingIndex < 0 || !row) return;

    const observer = new IntersectionObserver(([entry]) => setCurrentVisible(entry.isIntersecting));
    observer.observe(row);

    return () => observer.disconnect();
  }, [playingIndex, tracks]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorder) return;

    const from = tracks.findIndex((track) => track.id === active.id);
    const to = tracks.findIndex((track) => track.id === over.id);
    if (from < 0 || to < 0) return;

    onReorder(arrayMove(tracks, from, to).map((track) => track.id));
  };

  if (tracks.length === 0) {
    return <EmptyState icon={<MusicIcon size={24} />} title={emptyMessage ?? t("tracks.empty")} />;
  }

  const grid = rowGridFor(showAlbum, playedAt !== undefined, showTempoKey);

  const rows = tracks.map((track, index) => (
    <TrackRow
      key={playlistId ? `${track.id}-${index}` : track.id}
      track={track}
      index={index}
      focused={index === Math.min(focused, tracks.length - 1)}
      grid={grid}
      sortable={sortable}
      showCover={showCover}
      showAlbum={showAlbum}
      showArtist={showArtist}
      showAudioSpec={showAudioSpec}
      showTempoKey={showTempoKey}
      useTrackNumbers={useTrackNumbers}
      playedAt={playedAt?.[track.id]}
      showPlayedAt={playedAt !== undefined}
      playlistId={playlistId}
      playlistTrackIds={playlistTrackIds}
      isCurrent={currentTrackId === track.id}
      isPlaying={currentTrackId === track.id && isPlaying}
      isFavorite={isFavorite(track)}
      selectable={selectable}
      isSelected={selection?.selected.has(track.id) ?? false}
      onToggleSelected={onToggleSelected}
      menuOpen={menuFor === track.id}
      onMenuOpenChange={openMenuFor}
      onPlay={play}
      onToggleFavorite={likeTrack}
      onChanged={onChanged}
    />
  ));

  const body = (
    <div
      ref={bodyRef}
      className="library-track-list flex flex-col"
      role="table"
      aria-label={t("tracks.tableLabel")}
      onKeyDown={onRowsKeyDown}
    >
      <div className={cn(grid, "rounded-none border-b border-border pb-2")} role="row">
        {selection ? (
          <span role="columnheader" className="flex items-center">
            <Checkbox
              checked={
                selection.selected.size === 0
                  ? false
                  : tracks.every((track) => selection.selected.has(track.id))
                    ? true
                    : "indeterminate"
              }
              onClick={selection.onToggleAll}
              aria-label={t("tracks.selectAllOnPage")}
            />
          </span>
        ) : (
          <Caption role="columnheader" className="max-md:invisible">
            #
          </Caption>
        )}
        <Caption role="columnheader" className="truncate">
          {t("column.title")}
        </Caption>
        {showAlbum && (
          <Caption role="columnheader" className="track-extra-cell truncate max-md:hidden">
            {t("column.album")}
          </Caption>
        )}
        {playedAt && (
          <Caption role="columnheader" className="track-extra-cell truncate max-md:hidden">
            {t("column.played")}
          </Caption>
        )}
        {showTempoKey && (
          <Caption role="columnheader" className="track-extra-cell truncate max-md:hidden">
            {t("column.tempoKey")}
          </Caption>
        )}
        <span role="columnheader" aria-label={t("column.actions")} />
        <Caption role="columnheader" className="text-right max-[380px]:hidden">
          {t("column.duration")}
        </Caption>
      </div>

      {rows}
    </div>
  );

  return (
    <>
      {sortable ? (
        <VerticalSortable items={tracks.map((track) => track.id)} onDragEnd={onDragEnd}>
          {body}
        </VerticalSortable>
      ) : (
        body
      )}

      {playingIndex >= 0 && !currentVisible && (
        <Button
          variant="secondary"
          className="fixed bottom-[calc(var(--player-height)+1.5rem)] left-1/2 z-40 -translate-x-1/2 shadow-pop max-md:bottom-[calc(var(--player-height)+var(--mobile-nav-height)+env(safe-area-inset-bottom)+1rem)]"
          onClick={() =>
            bodyRef.current
              ?.querySelector(`[data-row="${playingIndex}"]`)
              ?.scrollIntoView({ block: "center", behavior: smoothUnlessReduced() })
          }
        >
          {t("tracks.jumpToCurrent")}
        </Button>
      )}
    </>
  );
}

interface TrackRowProps {
  track: Track;
  index: number;
  grid: string;
  sortable: boolean;
  showCover: boolean;
  showAlbum: boolean;
  showArtist: boolean;
  showAudioSpec: boolean;
  showTempoKey: boolean;
  useTrackNumbers: boolean;
  playedAt?: string;
  showPlayedAt: boolean;
  playlistId?: string;
  playlistTrackIds?: string[];
  focused: boolean;
  isCurrent: boolean;
  isPlaying: boolean;
  isFavorite: boolean;
  selectable: boolean;
  isSelected: boolean;
  onToggleSelected?: TrackSelection["onToggle"];
  menuOpen: boolean;
  onMenuOpenChange: (trackId: string, open: boolean) => void;
  onPlay: (index: number) => void;
  onToggleFavorite: (track: Track, isFavorite: boolean) => void;
  onChanged?: () => void;
}

const TrackRow = memo(function TrackRow({
  track,
  index,
  grid,
  sortable,
  showCover,
  showAlbum,
  showArtist,
  showAudioSpec,
  showTempoKey,
  useTrackNumbers,
  playedAt,
  showPlayedAt,
  playlistId,
  playlistTrackIds,
  focused,
  isCurrent,
  isPlaying,
  isFavorite,
  selectable,
  isSelected,
  onToggleSelected,
  menuOpen,
  onMenuOpenChange,
  onPlay,
  onToggleFavorite,
  onChanged,
}: TrackRowProps) {
  const t = useT();
  const format = useFormat();

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: track.id,
    disabled: !sortable,
  });

  const showSpec = showAudioSpec && isLossless(track.codec);

  return (
    <div
      ref={sortable ? setNodeRef : undefined}
      role="row"
      data-row={index}
      tabIndex={focused ? 0 : -1}
      onDoubleClick={() => onPlay(index)}
      onClick={(event) => {
        if (!window.matchMedia("(pointer: coarse)").matches) return;
        if ((event.target as HTMLElement).closest("a, button")) return;

        if (selectable) onToggleSelected?.(track.id, index, false);
        else onPlay(index);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenuOpenChange(track.id, true);
      }}
      style={sortable ? { transform: CSS.Transform.toString(transform), transition } : undefined}
      className={cn(
        grid,
        "library-track-row group relative transition-colors outline-none",
        "hover:bg-card focus-within:bg-card focus-visible:bg-card focus-visible:inset-ring focus-visible:inset-ring-ring",
        isCurrent && "track-row-current bg-card",
        isDragging && "z-10 opacity-90 shadow-pop",
      )}
    >
      <span className="flex items-center gap-1 text-sm text-faint tabular-nums" role="cell">
        {selectable ? (
          <Checkbox
            checked={isSelected}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSelected?.(track.id, index, event.shiftKey);
            }}
            aria-label={t("tracks.selectNamed", { title: track.title })}
          />
        ) : (
          <>
            {sortable && (
              <DragHandle
                {...attributes}
                {...listeners}
                aria-label={t("tracks.reorderNamed", { title: track.title })}
              />
            )}

            {isPlaying ? (
              <NowPlayingBars className="text-primary group-hover:hidden [@media(hover:none)]:hidden" />
            ) : (
              <span
                className={cn(
                  "group-hover:hidden [@media(hover:none)]:hidden",
                  isCurrent && "text-primary",
                )}
              >
                {useTrackNumbers ? (track.trackNumber ?? index + 1) : index + 1}
              </span>
            )}

            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden text-foreground group-hover:grid active:scale-95 max-md:size-8 [@media(hover:none)]:grid"
              onClick={() => onPlay(index)}
              aria-label={
                isPlaying
                  ? t("tracks.pauseNamed", { title: track.title })
                  : t("tracks.playNamed", { title: track.title })
              }
            >
              {isPlaying ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
            </Button>
          </>
        )}
      </span>

      <span className="flex min-w-0 items-center gap-3" role="cell">
        {showCover && <TrackCover track={track} size={40} className="library-track-cover" />}
        <span className="flex min-w-0 flex-col">
          <span className={cn("truncate font-semibold", isCurrent && "text-primary")}>
            {track.title}
          </span>
          {(showArtist || showSpec) && (
            <span className="flex min-w-0 items-center gap-2">
              {showArtist && (
                <ArtistLinks track={track} className="truncate text-sm text-muted-foreground" />
              )}

              {showSpec && (
                <span className="shrink-0 text-2xs font-medium text-faint max-md:hidden">
                  {formatAudioSpec(track)}
                </span>
              )}
            </span>
          )}
        </span>
      </span>

      {showAlbum && (
        <span
          className="track-extra-cell truncate text-sm text-muted-foreground max-md:hidden"
          role="cell"
        >
          {track.albumId && <Link href={`/albums/${track.albumId}`}>{track.albumTitle}</Link>}
        </span>
      )}

      {showPlayedAt && (
        <span
          className="track-extra-cell truncate text-sm text-muted-foreground max-md:hidden"
          role="cell"
        >
          {playedAt ? format.playedAt(playedAt) : ""}
        </span>
      )}

      {showTempoKey && <TempoKeyCell track={track} />}

      <span role="cell" className="flex items-center justify-end gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className={cn("max-md:hidden", isFavorite ? "text-primary" : !isCurrent && revealOnRow)}
          onClick={() => onToggleFavorite(track, isFavorite)}
          aria-label={isFavorite ? t("tracks.removeFromFavorites") : t("tracks.addToFavorites")}
          aria-pressed={isFavorite}
        >
          <HeartIcon size={16} className={isFavorite ? "fill-current" : undefined} />
        </Button>

        <TrackMenu
          track={track}
          open={menuOpen}
          onOpenChange={(open) => onMenuOpenChange(track.id, open)}
          playlistId={playlistId}
          playlistTrackIds={playlistTrackIds}
          onChanged={onChanged}
          isFavorite={isFavorite}
          onToggleFavorite={() => onToggleFavorite(track, isFavorite)}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className={cn(!isCurrent && revealOnRow)}
              aria-label={t("tracks.moreActions", { title: track.title })}
            >
              <EllipsisVerticalIcon size={16} />
            </Button>
          }
        />
      </span>

      <span
        className="text-right text-sm text-muted-foreground tabular-nums max-[380px]:hidden"
        role="cell"
      >
        {formatDuration(track.durationSeconds)}
      </span>
    </div>
  );
});

function TempoKeyCell({ track }: { track: Track }) {
  const t = useT();
  const bpm = track.cues?.bpm ? Math.round(track.cues.bpm) : null;
  const key = track.key ? keyName(track.key) : null;

  return (
    <span
      className="track-extra-cell truncate text-sm text-muted-foreground tabular-nums max-md:hidden"
      role="cell"
      title={
        bpm && key && track.key
          ? t("track.tempoKey", { bpm, key: `${key} (${track.key.camelot})` })
          : undefined
      }
    >
      {[bpm, track.key?.camelot].filter(Boolean).join(" · ")}
    </span>
  );
}

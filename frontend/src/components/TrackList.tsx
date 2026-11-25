// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { isDesktop, useDesktopUnavailable } from "@/desktop/api";
import { DownloadBadge } from "@/desktop/offline";

import { useT } from "@/contexts/I18nContext";
import { useNowPlaying, usePlayerActions } from "@/contexts/PlayerContext";
import { cn } from "@/lib/cn";
import { formatAudioSpec, formatDuration, isLossless } from "@/lib/format";
import { keyName } from "@/lib/musicalKey";
import { queueEntryKey } from "@/lib/playback/queueEntries";
import { samePlaybackCollection, type PlaybackCollection } from "@/lib/playback/playerTypes";
import { smoothUnlessReduced } from "@/lib/scroll";
import type { SortDirection, Track } from "@/lib/types";
import { useFormat } from "@/lib/useFormat";
import { useStableEntries } from "@/lib/useStableEntries";
import { useToggleFavorite } from "@/lib/useToggleFavorite";
import { type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EllipsisVerticalIcon,
  HeartIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
} from "lucide-react";
import { PrefetchLink as Link } from "@/components/PrefetchLink";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArtistLinks } from "./ArtistLinks";
import { TrackCover } from "./Cover";
import { EmptyState } from "./EmptyState";
import {
  PlaybackRowNumber,
  playbackDurationClass,
  playbackGridClass,
  playbackHeaderClass,
  playbackListClass,
  playbackNumberClass,
  playbackRowClass,
  playbackTitleClass,
} from "./PlaybackListRows";
import { TrackMenu, type TrackMenuProps } from "./TrackMenu";
import { DragHandle, VerticalSortable } from "./VerticalSortable";
import { VirtualList, type VirtualListHandle } from "./VirtualList";
import { Button } from "./ui/button";
import { Caption } from "./ui/caption";
import { Checkbox } from "./ui/checkbox";

interface TrackSelection {
  selected: ReadonlySet<string>;
  onToggle: (trackId: string, index: number, extend: boolean) => void;
  onToggleAll: () => void;
}

export type TrackSortColumn = "title" | "album" | "added" | "duration";

interface TrackTableSort {
  active?: TrackSortColumn;
  direction: SortDirection;
  onChange: (column: TrackSortColumn) => void;
}

interface TrackListProps {
  tracks: Track[];
  collection?: PlaybackCollection;
  showCover?: boolean;
  showAlbum?: boolean;
  showArtist?: boolean;
  showAudioSpec?: boolean;
  showTempoKey?: boolean;
  useTrackNumbers?: boolean;
  playedAt?: Record<string, string>;
  addedAt?: Readonly<Record<string, string>> | "createdAt";
  sort?: TrackTableSort;
  onChanged?: () => void;
  playlistId?: string;
  savedPlaylistTracks?: Track[];
  onOpenMembership?: TrackMenuProps["onOpenMembership"];
  onReorder?: (trackIds: string[]) => void;
  emptyMessage?: string;
  selection?: TrackSelection;
}

const ROW_COLUMNS = {
  "album+date":
    "grid-cols-[2rem_minmax(0,1.65fr)_minmax(0,1fr)_7rem_var(--track-duration)_var(--track-actions)]",
  album:
    "grid-cols-[2rem_minmax(0,1.65fr)_minmax(0,1fr)_var(--track-duration)_var(--track-actions)]",
  date: "grid-cols-[2rem_minmax(0,1fr)_7rem_var(--track-duration)_var(--track-actions)]",
  plain: "grid-cols-[2rem_minmax(0,1fr)_var(--track-duration)_var(--track-actions)]",
  "album+date+tempo":
    "grid-cols-[2rem_minmax(0,1.65fr)_minmax(0,1fr)_7rem_6rem_var(--track-duration)_var(--track-actions)]",
  "album+tempo":
    "grid-cols-[2rem_minmax(0,1.65fr)_minmax(0,1fr)_6rem_var(--track-duration)_var(--track-actions)]",
  "date+tempo":
    "grid-cols-[2rem_minmax(0,1fr)_7rem_6rem_var(--track-duration)_var(--track-actions)]",
  tempo: "grid-cols-[2rem_minmax(0,1fr)_6rem_var(--track-duration)_var(--track-actions)]",
} as const;

const revealOnRow =
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100 [@media(hover:none)]:opacity-100";

function rowGridFor(
  showAlbum: boolean,
  showDate: boolean,
  showTempoKey: boolean,
  showDurationOnMobile: boolean,
): string {
  const parts = [showAlbum && "album", showDate && "date", showTempoKey && "tempo"].filter(Boolean);
  const key = (parts.join("+") || "plain") as keyof typeof ROW_COLUMNS;
  return cn(
    playbackGridClass,
    "max-md:grid-cols-[2.125rem_minmax(0,1fr)_auto_var(--track-actions)]",
    !showDurationOnMobile && "max-[380px]:grid-cols-[2.125rem_minmax(0,1fr)_var(--track-actions)]",
    ROW_COLUMNS[key],
    isDesktop
      ? "[--track-duration:5.5rem] [--track-actions:3.5rem] pointer-coarse:[--track-actions:3.75rem]"
      : "[--track-duration:3.5rem] [--track-actions:4.625rem] pointer-coarse:[--track-actions:5.625rem] max-md:[--track-actions:2.5rem] max-md:pointer-coarse:[--track-actions:2.75rem]",
  );
}

export function TrackList({
  tracks,
  collection,
  showCover = true,
  showAlbum = true,
  showArtist = true,
  showAudioSpec = false,
  showTempoKey = false,
  useTrackNumbers = false,
  playedAt,
  addedAt,
  sort,
  onChanged,
  playlistId,
  savedPlaylistTracks = tracks,
  onOpenMembership,
  onReorder,
  emptyMessage,
  selection,
}: TrackListProps) {
  const nowPlaying = useNowPlaying();
  const { isPlaying } = nowPlaying;
  const currentTrackId =
    !collection ||
    !nowPlaying.collection ||
    samePlaybackCollection(collection, nowPlaying.collection)
      ? nowPlaying.currentTrackId
      : null;
  const actions = usePlayerActions();
  const entries = useStableEntries(tracks);
  const t = useT();

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [focused, setFocused] = useState(0);
  const [currentVisible, setCurrentVisible] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const viewport = useRef<VirtualListHandle>(null);
  const pendingFocus = useRef(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [columns, setColumns] = useState<"narrow" | "album" | "tempo" | "all">("all");
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      setColumns(width < 600 ? "narrow" : width < 900 ? "album" : width < 1050 ? "tempo" : "all");
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [tracks.length]);

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
      if (collection) actions.playQueue(tracks, index, { collection });
      else actions.playQueue(tracks, index);
    },
    [actions, collection, tracks],
  );

  const focusRow = (index: number) => {
    const clamped = Math.max(0, Math.min(index, tracks.length - 1));
    pendingFocus.current = true;
    viewport.current?.scrollToIndex(clamped);
    setFocused(clamped);
    bodyRef.current?.querySelector<HTMLElement>(`[data-row="${clamped}"]`)?.focus();
    return clamped;
  };

  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const row = bodyRef.current?.querySelector<HTMLElement>(`[data-row="${focused}"]`);
    if (row) {
      row.focus({ preventScroll: true });
      pendingFocus.current = false;
    }
  });

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

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusRow(event.key === "Home" ? 0 : tracks.length - 1);
      return;
    }

    if (event.key === " " && selection) {
      event.preventDefault();
      selection.onToggle(tracks[from].id, from, event.shiftKey);
    }

    if (event.key === "Enter") {
      event.preventDefault();
      play(from);
    }
  };

  const sortable = Boolean(playlistId && onReorder && !selection);

  const playlistTrackIds = useMemo(
    () => (playlistId ? savedPlaylistTracks.map((item) => item.id) : undefined),
    [playlistId, savedPlaylistTracks],
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

    const from = entries.findIndex((track) => queueEntryKey(track) === active.id);
    const to = entries.findIndex((track) => queueEntryKey(track) === over.id);
    if (from < 0 || to < 0) return;

    onReorder(arrayMove(tracks, from, to).map((track) => track.id));
  };

  if (tracks.length === 0) {
    return <EmptyState icon={<MusicIcon size={24} />} title={emptyMessage ?? t("tracks.empty")} />;
  }

  const visibleAlbum = showAlbum && columns !== "narrow" && (!showTempoKey || columns !== "album");
  const visibleAdded =
    addedAt !== undefined && columns !== "narrow" && (!showTempoKey || columns === "all");
  const visibleDate =
    addedAt !== undefined ? visibleAdded : playedAt !== undefined && columns === "all";
  const visibleTempo = showTempoKey && columns !== "narrow";
  const showDurationOnMobile = sort !== undefined;
  const grid = rowGridFor(visibleAlbum, visibleDate, visibleTempo, showDurationOnMobile);

  const rows = tracks.map((track, index) => (
    <TrackRow
      key={queueEntryKey(entries[index])}
      entryId={queueEntryKey(entries[index])}
      track={track}
      index={index}
      focused={index === Math.min(focused, tracks.length - 1)}
      grid={grid}
      sortable={sortable}
      showCover={showCover}
      showAlbum={visibleAlbum}
      showArtist={showArtist}
      showAudioSpec={showAudioSpec}
      showTempoKey={visibleTempo}
      showDurationOnMobile={showDurationOnMobile}
      useTrackNumbers={useTrackNumbers}
      date={addedAt === "createdAt" ? track.createdAt : (addedAt ?? playedAt)?.[track.id]}
      dateKind={visibleDate ? (visibleAdded ? "added" : "played") : undefined}
      playlistId={playlistId}
      playlistTrackIds={playlistTrackIds}
      onOpenMembership={onOpenMembership}
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
      className={playbackListClass}
      role="table"
      aria-rowcount={tracks.length + 1}
      aria-label={t("tracks.tableLabel")}
      onKeyDown={onRowsKeyDown}
    >
      <div className={cn(grid, playbackHeaderClass)} role="row">
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
        <TrackColumnHeader column="title" sort={sort}>
          {t("column.title")}
        </TrackColumnHeader>
        {visibleAlbum && (
          <TrackColumnHeader column="album" sort={sort} className="track-album-cell max-md:hidden">
            {t("column.album")}
          </TrackColumnHeader>
        )}
        {visibleDate && (
          <TrackColumnHeader
            column="added"
            sort={visibleAdded ? sort : undefined}
            className="track-date-cell max-md:hidden"
          >
            {t(visibleAdded ? "column.added" : "column.played")}
          </TrackColumnHeader>
        )}
        {visibleTempo && (
          <Caption role="columnheader" className="track-tempo-cell truncate max-md:hidden">
            {t("column.tempoKey")}
          </Caption>
        )}
        <TrackColumnHeader
          column="duration"
          sort={sort}
          className={cn("text-right", !showDurationOnMobile && "max-[380px]:hidden")}
        >
          {t("column.duration")}
        </TrackColumnHeader>
        <span role="columnheader" aria-label={t("column.actions")} />
      </div>

      {rows.length > 100 ? (
        <VirtualList
          ref={viewport}
          items={rows}
          role="rowgroup"
          estimate={showCover ? 64 : 48}
          pinned={[
            focused,
            playingIndex,
            tracks.findIndex((track) => track.id === menuFor),
            entries.findIndex((track) => queueEntryKey(track) === dragging),
          ]}
        />
      ) : (
        rows
      )}
    </div>
  );

  return (
    <>
      {sortable ? (
        <VerticalSortable
          items={entries.map(queueEntryKey)}
          onDragEnd={onDragEnd}
          onActiveChange={setDragging}
          constrainToScroll={rows.length > 100}
        >
          {body}
        </VerticalSortable>
      ) : (
        body
      )}

      {playingIndex >= 0 && !currentVisible && (
        <Button
          variant="secondary"
          className="fixed bottom-[calc(var(--player-height)+1.5rem)] left-1/2 z-40 -translate-x-1/2 shadow-pop max-md:bottom-[calc(var(--player-height)+var(--mobile-nav-height)+env(safe-area-inset-bottom)+1rem)]"
          onClick={() => {
            viewport.current?.scrollToIndex(playingIndex);
            bodyRef.current
              ?.querySelector(`[data-row="${playingIndex}"]`)
              ?.scrollIntoView({ block: "center", behavior: smoothUnlessReduced() });
          }}
        >
          {t("tracks.jumpToCurrent")}
        </Button>
      )}
    </>
  );
}

function TrackColumnHeader({
  column,
  sort,
  className,
  children,
}: {
  column: TrackSortColumn;
  sort?: TrackTableSort;
  className?: string;
  children: string;
}) {
  const active = sort?.active === column;
  const DirectionIcon = sort?.direction === "desc" ? ArrowDownIcon : ArrowUpIcon;
  return (
    <Caption
      role="columnheader"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
      className={cn("min-w-0 truncate", className)}
    >
      {sort ? (
        <button
          type="button"
          onClick={() => sort.onChange(column)}
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-sm align-middle hover:text-foreground focus-visible:outline-offset-0",
            active && "text-primary",
          )}
        >
          <span className="truncate">{children}</span>
          {active && <DirectionIcon size={13} className="shrink-0" aria-hidden="true" />}
        </button>
      ) : (
        children
      )}
    </Caption>
  );
}

interface TrackRowProps {
  entryId: string;
  track: Track;
  index: number;
  grid: string;
  sortable: boolean;
  showCover: boolean;
  showAlbum: boolean;
  showArtist: boolean;
  showAudioSpec: boolean;
  showTempoKey: boolean;
  showDurationOnMobile: boolean;
  useTrackNumbers: boolean;
  date?: string;
  dateKind?: "added" | "played";
  playlistId?: string;
  playlistTrackIds?: string[];
  onOpenMembership?: TrackMenuProps["onOpenMembership"];
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

const TrackRow = memo(function TrackRow(props: TrackRowProps) {
  return props.sortable ? <SortableTrackRow {...props} /> : <TrackRowContent {...props} />;
});

function SortableTrackRow(props: TrackRowProps) {
  const drag = useSortable({ id: props.entryId });
  return <TrackRowContent {...props} drag={drag} />;
}

const TrackRowContent = memo(function TrackRowContent({
  track,
  index,
  grid,
  sortable,
  showCover,
  showAlbum,
  showArtist,
  showAudioSpec,
  showTempoKey,
  showDurationOnMobile,
  useTrackNumbers,
  date,
  dateKind,
  playlistId,
  playlistTrackIds,
  onOpenMembership,
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
  drag,
}: TrackRowProps & { drag?: ReturnType<typeof useSortable> }) {
  const t = useT();
  const format = useFormat();
  const unavailable = useDesktopUnavailable(track.id);
  const play = () => {
    if (!unavailable) onPlay(index);
  };

  const showSpec = showAudioSpec && isLossless(track.codec);
  const favorite = (
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
  );
  return (
    <div
      ref={drag?.setNodeRef}
      role="row"
      data-row={index}
      aria-rowindex={index + 2}
      data-striped={index % 2 === 0 || undefined}
      tabIndex={focused ? 0 : -1}
      onDoubleClick={play}
      onClick={(event) => {
        if (!window.matchMedia("(pointer: coarse)").matches) return;
        if ((event.target as HTMLElement).closest("a, button")) return;

        if (selectable) onToggleSelected?.(track.id, index, false);
        else play();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenuOpenChange(track.id, true);
      }}
      style={
        drag
          ? { transform: CSS.Transform.toString(drag.transform), transition: drag.transition }
          : undefined
      }
      className={cn(
        grid,
        playbackRowClass(isCurrent),
        unavailable && "opacity-55",
        drag?.isDragging && "z-10 opacity-90 shadow-pop",
      )}
    >
      <span className={playbackNumberClass} role="cell">
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
                {...drag?.attributes}
                {...drag?.listeners}
                aria-label={t("tracks.reorderNamed", { title: track.title })}
              />
            )}

            <PlaybackRowNumber
              number={useTrackNumbers ? (track.trackNumber ?? index + 1) : index + 1}
              current={isCurrent}
              playing={isPlaying}
            />

            <Button
              variant="ghost"
              size="icon-sm"
              className="hidden text-foreground group-hover:grid active:scale-95 max-md:size-8 [@media(hover:none)]:grid"
              disabled={unavailable}
              onClick={play}
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
          <span className={cn(playbackTitleClass, isCurrent && "text-primary")}>{track.title}</span>
          {(showArtist || showSpec) && (
            <span className="flex min-w-0 items-center gap-2">
              {showArtist && (
                <ArtistLinks track={track} className="library-secondary truncate text-sm" />
              )}

              {showSpec && (
                <span className="track-audio-spec library-tertiary shrink-0 max-md:hidden">
                  {formatAudioSpec(track)}
                </span>
              )}
            </span>
          )}
        </span>
      </span>

      {showAlbum && (
        <span
          className="track-album-cell library-secondary truncate text-sm max-md:hidden"
          role="cell"
        >
          {track.albumId && <Link href={`/albums/${track.albumId}`}>{track.albumTitle}</Link>}
        </span>
      )}

      {dateKind && (
        <span
          className="track-date-cell library-secondary truncate text-sm max-md:hidden"
          role="cell"
        >
          {date && (
            <time dateTime={date} title={dateKind === "added" ? format.playedAt(date) : undefined}>
              {dateKind === "added" ? format.relativeDate(date) : format.playedAt(date)}
            </time>
          )}
        </span>
      )}

      {showTempoKey && <TempoKeyCell track={track} />}

      <span
        className={cn(
          playbackDurationClass,
          "flex items-center justify-end gap-1",
          !showDurationOnMobile && "max-[380px]:hidden",
        )}
        role="cell"
        data-track-duration
      >
        {isDesktop && favorite}
        {formatDuration(track.durationSeconds)}
      </span>
      <span role="cell" className="flex items-center justify-end gap-0.5">
        {isDesktop ? <DownloadBadge id={track.id} /> : favorite}

        <TrackMenu
          track={track}
          open={menuOpen}
          onOpenChange={(open) => onMenuOpenChange(track.id, open)}
          playlistId={playlistId}
          playlistTrackIds={playlistTrackIds}
          onOpenMembership={onOpenMembership}
          onChanged={onChanged}
          isFavorite={isFavorite}
          onToggleFavorite={() => onToggleFavorite(track, isFavorite)}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className={cn(!isDesktop && !isCurrent && revealOnRow)}
              aria-label={t("tracks.moreActions", { title: track.title })}
            >
              <EllipsisVerticalIcon size={isDesktop ? 18 : 16} />
            </Button>
          }
        />
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
      className="track-tempo-cell truncate tabular-nums max-md:hidden"
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

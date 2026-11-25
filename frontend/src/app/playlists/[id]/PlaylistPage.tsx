// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { LibrarySaveButton } from "@/components/LibrarySaveButton";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "@/lib/api";
import { playlistCoverUrl } from "@/lib/media";
import { queries } from "@/lib/queries";
import { useFormat } from "@/lib/useFormat";
import { useInvalidate } from "@/lib/useInvalidate";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { playlistSortOptions, sortPlaylistTracks, type PlaylistSort } from "@/lib/playlistTracks";
import type { PlaylistDetail, Track } from "@/lib/types";
import { useRecommendations } from "@/lib/useRecommendations";
import { useRowSelection } from "@/lib/useRowSelection";
import { useCoverTone } from "@/lib/useCoverTone";
import { useTrackSort } from "@/lib/useTrackSort";
import { useToast } from "@/lib/useToast";
import { mosaicBackdrop } from "@/components/collection/CoverMosaic";
import { PlaylistCover } from "@/components/collection/PlaylistCover";
import { PlayAllButton } from "@/components/PlayAllButton";
import { ShuffleButton } from "@/components/ShuffleButton";
import type { ReturnFocus } from "@/components/PlaylistActionDialog";
import { PlaylistAddTracksDialog } from "@/components/PlaylistAddTracksDialog";
import { PlaylistDestinationDialog } from "@/components/PlaylistDestinationDialog";
import { PlaylistMembershipDialog } from "@/components/PlaylistMembershipDialog";
import { SearchField } from "@/components/SearchField";
import { TrackSortMenu } from "@/components/TrackSortMenu";
import { EmptyState } from "@/components/EmptyState";
import { Query } from "@/components/Query";
import { TrackList, type TrackSortColumn } from "@/components/TrackList";
import { isDesktop } from "@/desktop/api";
import { DesktopCollectionDownload } from "@/desktop/offline";
import { useConfirm } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  EllipsisIcon,
  ListMusicIcon,
  ListPlusIcon,
  ListVideoIcon,
  ListXIcon,
  PencilIcon,
  PlusIcon,
  RadioIcon,
  ListChecksIcon,
  Trash2Icon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PlaylistDialog = dynamic(() =>
  import("@/components/PlaylistDialog").then((m) => m.PlaylistDialog),
);

const SORT_COLUMNS: TrackSortColumn[] = ["title", "album", "added", "duration"];

export function PlaylistPage() {
  const id = useParams<{ id: string }>().id;
  const playlist = useQuery(queries.playlist(id));
  return (
    <Query result={playlist}>{(detail) => <PlaylistContent key={id} detail={detail} />}</Query>
  );
}

function PlaylistContent({ detail }: { detail: PlaylistDetail }) {
  const { t, locale } = useI18n();
  const format = useFormat();
  const { id } = detail;
  const router = useRouter();
  const client = useQueryClient();
  const invalidate = useInvalidate();
  const { notify, notifyError } = useToast();
  const { user } = useAuth();
  const player = usePlayerActions();
  const recommendations = useRecommendations();
  const [confirm, confirmDialog] = useConfirm();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [destination, setDestination] = useState<"copy" | "selected" | null>(null);
  const [membership, setMembership] = useState<{ track: Track; returnFocus: ReturnFocus } | null>(
    null,
  );
  const sorting = useTrackSort<PlaylistSort>("manual", { added: "desc" });
  const { value: sort, direction } = sorting;
  const [search, setSearch] = useState("");
  const [selecting, setSelecting] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const selectButton = useRef<HTMLButtonElement>(null);
  const destinationButton = useRef<HTMLButtonElement>(null);

  const isOwner = user?.id === detail.ownerId;
  const cover = detail.hasCover
    ? playlistCoverUrl({ playlistId: id, hasCover: true, variant: "thumb" })
    : mosaicBackdrop(detail.tracks);
  const tone = useCoverTone(cover, "backdrop");
  const coverStyle = tone
    ? ({
        "--playlist-tint": `oklch(0.55 ${Math.min(tone.chroma * 1.35, 0.23)} ${tone.hue})`,
      } as CSSProperties)
    : undefined;

  const sorted = useMemo(
    () => sortPlaylistTracks(detail, sort, locale, direction),
    [detail, sort, locale, direction],
  );
  const displayed = useMemo(() => {
    const term = search.toLocaleLowerCase(locale);
    if (!term) return sorted;
    return sorted.filter((track) =>
      [
        track.title,
        track.artistName,
        track.albumTitle,
        ...(track.artists ?? []).map(({ name }) => name),
      ].some((name) => name?.toLocaleLowerCase(locale).includes(term)),
    );
  }, [sorted, search, locale]);
  const ids = useMemo(() => displayed.map((track) => track.id), [displayed]);
  const selection = useRowSelection(ids, JSON.stringify([id, search]));
  const { clear } = selection;
  const selected = displayed.filter((track) => selection.selected.has(track.id));
  const selectedIds = selected.map((track) => track.id);
  const stopSelecting = useCallback(() => {
    setSelecting(false);
    clear();
  }, [clear]);

  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="listbox"], [role="menu"]',
        )
      ) {
        stopSelecting();
        selectButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selecting, stopSelecting]);

  const openMembership = useCallback((track: Track, returnFocus: ReturnFocus) => {
    setMembership({ track, returnFocus: () => returnFocus() ?? menuButton.current });
  }, []);

  const radio = useMutation({
    mutationFn: () => player.startPlaylistRadio(id, detail.tracks),
    onSuccess: (status) => {
      if (status === "noAudio") notify(t("playlists.radioNoAudio"), "info");
      if (status === "empty") notify(t("playlists.radioEmpty"), "info");
      if (status === "unavailable") notify(t("radio.failed"), "info");
    },
    onError: (error) => notifyError(error, t("radio.failed")),
  });

  const bulkRemove = useMutation({
    mutationFn: (trackIds: string[]) => api.changePlaylistMembership(id, trackIds, false),
    onSuccess: () => {
      invalidate("playlists");
      stopSelecting();
      notify(t("menu.removedFromPlaylist"), "success");
    },
    onError: (error) => notifyError(error, t("playlists.changeFailed")),
  });

  const remove = useMutation({
    mutationFn: () => api.deletePlaylist(id),
    onSuccess: () => {
      notify(t("playlists.deleted"), "success");
      invalidate("playlists");
      router.push("/search?tab=playlists");
    },
  });

  const key = queries.playlist(id).queryKey;

  const reorder = useMutation({
    mutationFn: (trackIds: string[]) => api.reorderPlaylist(id, trackIds),
    onMutate: async (trackIds) => {
      await client.cancelQueries({ queryKey: key });
      client.setQueryData(key, (current) => {
        if (!current) return current;
        const tracksById = new Map(current.tracks.map((track) => [track.id, track]));
        const tracks = trackIds.flatMap((trackId) => {
          const track = tracksById.get(trackId);
          if (!track) return [];
          tracksById.delete(trackId);
          return [track];
        });
        return { ...current, tracks: [...tracks, ...tracksById.values()] };
      });
    },
    onSuccess: () => invalidate("playlists"),
    onError: () => client.invalidateQueries({ queryKey: key }),
  });

  return (
    <div className="playlist-page @container flex min-w-0 flex-col gap-3">
      <header className="playlist-hero" style={coverStyle} data-detail-backdrop="">
        <div className="playlist-hero-cover">
          <PlaylistCover
            playlist={{ ...detail, coverTracks: detail.tracks }}
            variant="full"
            sizes="(min-width: 64rem) 224px, 192px"
            fallback={<ListMusicIcon size={48} />}
          />
        </div>
        <div className="playlist-hero-copy">
          <p className="playlist-visibility text-sm font-medium">
            {t(detail.isPublic ? "playlists.publicBadge" : "playlists.privateBadge")}
          </p>
          <h1 className="playlist-hero-title wrap-anywhere">{detail.name}</h1>
          {detail.description && (
            <p className="playlist-description max-w-[62ch] text-sm wrap-anywhere">
              {detail.description}
            </p>
          )}
          <p className="playlist-facts">
            {detail.ownerName && (
              <strong className="font-semibold text-foreground">{detail.ownerName}</strong>
            )}
            <span>{t("count.tracks", { count: detail.tracks.length })}</span>
            {detail.durationSeconds > 0 && (
              <span>{format.totalDuration(detail.durationSeconds)}</span>
            )}
          </p>
        </div>
      </header>

      <div className="playlist-toolbar">
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <PlayAllButton tracks={displayed} name={detail.name} className="size-13 sm:size-14" />
          <ShuffleButton tracks={displayed} iconOnly />
          <LibrarySaveButton kind="playlist" id={id} />
          {isDesktop && <DesktopCollectionDownload tracks={detail.tracks} />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuButton}
                variant="ghost"
                size="icon-lg"
                aria-label={t("tracks.moreActions", { title: detail.name })}
              >
                <EllipsisIcon size={22} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-[min(22rem,calc(100vw-2rem))]">
              <DropdownMenuItem onSelect={() => setDestination("copy")}>
                <ListPlusIcon size={16} /> {t("playlists.copyAll")}
              </DropdownMenuItem>
              {recommendations && (
                <DropdownMenuItem disabled={radio.isPending} onSelect={() => radio.mutate()}>
                  <RadioIcon size={16} /> {t("playlists.radio")}
                </DropdownMenuItem>
              )}
              {isOwner && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() =>
                    confirm({
                      title: t("playlists.confirmDelete", { name: detail.name }),
                      confirmLabel: t("action.delete"),
                      destructive: true,
                      action: () => remove.mutate(),
                    })
                  }
                >
                  <Trash2Icon size={16} /> {t("action.delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {detail.tracks.length > 0 && (
          <div className="playlist-list-tools">
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder={t("playlists.findTracks")}
              className="playlist-search [&_input]:py-2 [&_input]:text-sm"
            />
            <TrackSortMenu {...sorting} options={playlistSortOptions} manual="manual" />
          </div>
        )}
      </div>

      {(isOwner || detail.tracks.length > 0) && (
        <div className="playlist-edit-actions flex flex-wrap items-center gap-2">
          {isOwner && (
            <>
              <Button
                ref={addButton}
                variant="secondary"
                size="sm"
                className="pointer-coarse:h-11"
                onClick={() => setAdding(true)}
              >
                <PlusIcon size={15} /> {t("playlists.addTracks")}
              </Button>
              <Button
                ref={editButton}
                variant="secondary"
                size="sm"
                className="pointer-coarse:h-11"
                onClick={() => setEditing(true)}
              >
                <PencilIcon size={14} /> {t("action.edit")}
              </Button>
            </>
          )}
          {detail.tracks.length > 0 && (
            <Button
              ref={selectButton}
              variant={selecting ? "secondary" : "ghost"}
              size="sm"
              className="pointer-coarse:h-11"
              aria-pressed={selecting}
              disabled={bulkRemove.isPending}
              onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
            >
              <ListChecksIcon size={15} />
              {selecting ? t("tracks.exitSelectMode") : t("tracks.selectMode")}
            </Button>
          )}
        </div>
      )}

      {radio.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("menu.radioStarting")}
        </p>
      )}
      {detail.tracks.length === 0 ? (
        <EmptyState icon={<ListMusicIcon size={24} />} title={t("playlists.emptyPlaylistTitle")} />
      ) : (
        <section aria-label={t("albums.tracks")} className="flex min-w-0 flex-col gap-2">
          {selecting && (
            <div className="flex flex-wrap items-center gap-2">
              <p role="status" className="mr-2 text-sm text-muted-foreground">
                {t("tracks.selectedCount", { count: selected.length })}
              </p>
              <Button
                ref={destinationButton}
                variant="secondary"
                disabled={!selected.length || bulkRemove.isPending}
                onClick={() => setDestination("selected")}
              >
                <ListPlusIcon size={16} /> {t("playlists.otherPlaylist")}
              </Button>
              <Button
                variant="secondary"
                disabled={!selected.length || bulkRemove.isPending}
                onClick={() => {
                  selected.forEach(player.addToQueue);
                  stopSelecting();
                  selectButton.current?.focus();
                }}
              >
                <ListVideoIcon size={16} /> {t("menu.addToQueue")}
              </Button>
              {isOwner && (
                <Button
                  variant="secondary"
                  disabled={!selected.length || bulkRemove.isPending}
                  onClick={() =>
                    confirm({
                      title: t("playlists.removeSelected", { count: selected.length }),
                      confirmLabel: t("menu.removeFromPlaylist"),
                      destructive: true,
                      action: () => bulkRemove.mutate(selectedIds),
                    })
                  }
                >
                  <ListXIcon size={16} />{" "}
                  {bulkRemove.isPending ? t("action.saving") : t("menu.removeFromPlaylist")}
                </Button>
              )}
            </div>
          )}
          <TrackList
            tracks={displayed}
            addedAt={detail.trackAddedAt ?? {}}
            sort={{
              active: SORT_COLUMNS.find((column) => column === sort),
              direction,
              onChange: sorting.onChange,
            }}
            emptyMessage={search ? t("filter.nothingMatched") : undefined}
            savedPlaylistTracks={detail.tracks}
            playlistId={isOwner ? id : undefined}
            onReorder={
              isOwner && sort === "manual" && !search
                ? (order) => {
                    if (!reorder.isPending) reorder.mutate(order);
                  }
                : undefined
            }
            onOpenMembership={openMembership}
            selection={
              selecting
                ? {
                    selected: new Set(selectedIds),
                    onToggle: selection.toggle,
                    onToggleAll: selection.toggleAll,
                  }
                : undefined
            }
          />
        </section>
      )}

      {editing && isOwner && (
        <PlaylistDialog
          playlist={detail}
          onClose={() => setEditing(false)}
          onSaved={() => invalidate("playlists")}
          returnFocus={() => editButton.current}
        />
      )}
      {adding && isOwner && (
        <PlaylistAddTracksDialog
          playlist={detail}
          onClose={() => setAdding(false)}
          returnFocus={() => addButton.current}
        />
      )}
      {destination && (
        <PlaylistDestinationDialog
          sourceId={id}
          title={t(destination === "copy" ? "playlists.copyAll" : "playlists.otherPlaylist")}
          onChoose={(destinationId) =>
            destination === "copy"
              ? api.copyPlaylistTracks(id, destinationId)
              : api.changePlaylistMembership(destinationId, selectedIds, true)
          }
          onDone={destination === "selected" ? stopSelecting : undefined}
          onClose={() => setDestination(null)}
          returnFocus={() =>
            destination === "copy"
              ? menuButton.current
              : (destinationButton.current ?? selectButton.current ?? menuButton.current)
          }
        />
      )}
      {membership && (
        <PlaylistMembershipDialog
          track={membership.track}
          onClose={() => setMembership(null)}
          returnFocus={membership.returnFocus}
        />
      )}
      {confirmDialog}
    </div>
  );
}

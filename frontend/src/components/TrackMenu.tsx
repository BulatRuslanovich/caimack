// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import dynamic from "next/dynamic";
import type { EditableArtist } from "./EditArtistDialog";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Slot } from "@radix-ui/react-slot";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useState,
  useSyncExternalStore,
} from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { extensionOf } from "@/lib/playback/audioFormats";
import { saveFile } from "@/lib/download";
import { recordEvent } from "@/lib/events";
import { creditsOf, formatArtists } from "@/lib/format";
import { queries } from "@/lib/queries";
import { useInvalidate } from "@/lib/useInvalidate";
import type { ArtistRef, Playlist, Track } from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/contexts/I18nContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useToast } from "@/lib/useToast";
import { TrackCover } from "./Cover";
import { Loading } from "./Loading";
import { useConfirm } from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  ChevronDownIcon,
  CornerDownRightIcon,
  Disc3Icon,
  DownloadIcon,
  EllipsisVerticalIcon,
  HeartIcon,
  ImageIcon,
  InfoIcon,
  ListMusicIcon,
  ListPlusIcon,
  ListVideoIcon,
  ListXIcon,
  PencilIcon,
  PlusIcon,
  RadioIcon,
  Share2Icon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UsersRoundIcon,
} from "lucide-react";

const EditArtistDialog = dynamic(() =>
  import("./EditArtistDialog").then((m) => m.EditArtistDialog),
);
const EditTrackDialog = dynamic(() => import("./EditTrackDialog").then((m) => m.EditTrackDialog));
const TrackInfoDialog = dynamic(() => import("./TrackInfoDialog").then((m) => m.TrackInfoDialog));
const ShareCardDialog = dynamic(() => import("./ShareCardDialog").then((m) => m.ShareCardDialog));
const PlaylistDialog = dynamic(() => import("./PlaylistDialog").then((m) => m.PlaylistDialog));

interface TrackMenuProps {
  track: Track;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlistId?: string;
  playlistTrackIds?: string[];
  onChanged?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onNavigate?: () => void;
  trigger?: ReactElement;
}

const COMPACT = "(width < 56.25rem)";

function subscribeCompact(onChange: () => void) {
  const query = window.matchMedia(COMPACT);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const SheetMenu = createContext<{ open: boolean; onOpenChange: (open: boolean) => void } | null>(
  null,
);

const sheetRow = cn(
  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent hover:no-underline",
  "disabled:pointer-events-none disabled:text-faint [&_svg]:size-5 [&_svg]:shrink-0",
);

export function TrackMenu({ open, onOpenChange, trigger, ...rest }: TrackMenuProps) {
  const t = useT();
  const [everOpened, setEverOpened] = useState(open);
  const compact = useSyncExternalStore(
    subscribeCompact,
    () => window.matchMedia(COMPACT).matches,
    () => false,
  );

  if (open && !everOpened) setEverOpened(true);

  const button = trigger ?? (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("tracks.moreActions", { title: rest.track.title })}
    >
      <EllipsisVerticalIcon size={16} />
    </Button>
  );

  if (compact) {
    return (
      <SheetMenu.Provider value={{ open, onOpenChange }}>
        <Slot onClick={() => onOpenChange(true)}>{button}</Slot>
        {everOpened && <TrackMenuBody {...rest} onOpenChange={onOpenChange} />}
      </SheetMenu.Provider>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>

      {everOpened && <TrackMenuBody {...rest} onOpenChange={onOpenChange} />}
    </DropdownMenu>
  );
}

function MenuContent({ track, children }: { track: Track; children: ReactNode }) {
  const sheet = useContext(SheetMenu);

  if (!sheet) return <DropdownMenuContent>{children}</DropdownMenuContent>;

  return (
    <Sheet open={sheet.open} onOpenChange={sheet.onOpenChange}>
      <SheetContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
      >
        <div className="flex items-center gap-3 px-3 pb-3">
          <TrackCover track={track} size={44} />
          <span className="flex min-w-0 flex-col">
            <SheetTitle className="truncate text-base font-semibold">{track.title}</SheetTitle>
            <span className="truncate text-sm text-muted-foreground">{formatArtists(track)}</span>
          </span>
        </div>
        <MenuSeparator />
        {children}
      </SheetContent>
    </Sheet>
  );
}

function MenuItem({
  onSelect,
  disabled,
  variant,
  asChild,
  children,
}: {
  onSelect?: (event: Event) => void;
  disabled?: boolean;
  variant?: "destructive";
  asChild?: boolean;
  children: ReactNode;
}) {
  const sheet = useContext(SheetMenu);

  if (!sheet) {
    return (
      <DropdownMenuItem onSelect={onSelect} disabled={disabled} variant={variant} asChild={asChild}>
        {children}
      </DropdownMenuItem>
    );
  }

  const run = () => {
    const select = new Event("select", { cancelable: true });
    onSelect?.(select);
    if (!select.defaultPrevented) sheet.onOpenChange(false);
  };

  const className = cn(sheetRow, variant === "destructive" && "text-destructive");

  return asChild ? (
    <Slot className={className} onClick={run}>
      {children}
    </Slot>
  ) : (
    <button type="button" disabled={disabled} className={className} onClick={run}>
      {children}
    </button>
  );
}

function MenuSeparator() {
  const sheet = useContext(SheetMenu);

  return sheet ? <div className="my-1.5 h-px shrink-0 bg-border" /> : <DropdownMenuSeparator />;
}

function MenuSub({ label, children }: { label: ReactNode; children: ReactNode }) {
  const sheet = useContext(SheetMenu);
  const [expanded, setExpanded] = useState(false);

  if (!sheet) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>{children}</DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        className={sheetRow}
      >
        {label}
        <ChevronDownIcon className={cn("ml-auto text-faint", expanded && "rotate-180")} />
      </button>
      {expanded && <div className="ml-5 flex flex-col border-l border-border pl-2">{children}</div>}
    </>
  );
}

function TrackMenuBody({
  track,
  onOpenChange,
  playlistId,
  playlistTrackIds,
  onChanged,
  isFavorite,
  onToggleFavorite,
  onNavigate,
}: Omit<TrackMenuProps, "open" | "trigger">) {
  const { notify, notifyError } = useToast();
  const { isAdmin } = useAuth();
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [showingInfo, setShowingInfo] = useState(false);
  const [sharingCard, setSharingCard] = useState(false);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [editingArtist, setEditingArtist] = useState<EditableArtist | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const player = usePlayerActions();
  const invalidate = useInvalidate();
  const playlists = useQuery(queries.playlists());
  const addRule = useMutation({
    mutationFn: api.addTasteRule,
    onSuccess: (rule) => {
      invalidate("recommendations");
      notify(t(`rules.added.${rule.action}`, { name: rule.name }), "success", {
        label: t("action.undo"),
        run: () => void api.removeTasteRule(rule.id).then(() => invalidate("recommendations")),
      });
    },
    onError: (error) => notifyError(error),
  });

  const credits = creditsOf(track);

  const changed = () => {
    invalidate("library", "playlists");
    onChanged?.();
  };

  const stayOpen = (run: () => void) => (event: Event) => {
    event.preventDefault();
    run();
  };

  const addTo = useMutation({
    mutationFn: (playlist: Playlist) => api.addToPlaylist(playlist.id, [track.id]),
    onSuccess: (_, playlist) => {
      recordEvent({ type: "trackAddedToPlaylist", trackId: track.id, entityId: playlist.id });
      notify(t("menu.addedToPlaylist", { name: playlist.name }), "success");
      onOpenChange(false);
    },
  });

  const share = async () => {
    const path = track.albumId ? `/albums/${track.albumId}` : `/artists/${track.artistId}`;
    const url = `${window.location.origin}${path}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: track.title,
          text: `${track.title} — ${formatArtists(track)}`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        notify(t("menu.linkCopied"), "success");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      notifyError(error, t("menu.shareFailed"));
    }
  };

  const radio = useMutation({
    mutationFn: () => player.startRadio(track),
    onSuccess: (started) => {
      if (!started) return;
      notify(t("menu.radioStarted", { title: track.title }), "success");
      onOpenChange(false);
    },
  });

  const editArtist = useMutation({
    mutationFn: (artist: ArtistRef) => api.artist(artist.id, { page: 1, pageSize: 1 }),
    onSuccess: (detail) => {
      setEditingArtist({ id: detail.id, name: detail.name, hasImage: detail.hasImage });
      onOpenChange(false);
    },
  });

  const download = useMutation({
    mutationFn: () =>
      api.downloadTrack(track.id, `${track.title}${extensionOf(track.originalFileName) || ".mp3"}`),
    onSuccess: (file) => {
      saveFile(file);
      onOpenChange(false);
    },
  });

  const undoRemove = useMutation({
    mutationFn: async (playlist: string) => {
      await api.addToPlaylist(playlist, [track.id]);
      if (playlistTrackIds) await api.reorderPlaylist(playlist, playlistTrackIds);
    },
    onSuccess: changed,
  });

  const removeFromPlaylist = useMutation({
    mutationFn: (playlist: string) => api.removeFromPlaylist(playlist, track.id),
    onSuccess: (_, playlist) => {
      recordEvent({ type: "trackRemovedFromPlaylist", trackId: track.id, entityId: playlist });
      notify(t("menu.removedFromPlaylist"), "success", {
        label: t("action.undo"),
        run: () => undoRemove.mutate(playlist),
      });
      changed();
    },
  });

  const deleteTrack = useMutation({
    mutationFn: () => api.deleteTrack(track.id),
    onSuccess: () => {
      notify(t("menu.trackDeleted", { title: track.title }), "success");
      changed();
    },
  });

  return (
    <>
      <MenuContent track={track}>
        <MenuItem
          onSelect={() => {
            player.playNext(track);
            notify(t("menu.playingNext", { title: track.title }), "success");
          }}
        >
          <CornerDownRightIcon size={16} /> {t("menu.playNext")}
        </MenuItem>

        <MenuItem
          onSelect={() => {
            player.addToQueue(track);
            notify(t("menu.addedToQueue", { title: track.title }), "success");
          }}
        >
          <ListVideoIcon size={16} /> {t("menu.addToQueue")}
        </MenuItem>

        <MenuItem disabled={radio.isPending} onSelect={stayOpen(() => radio.mutate())}>
          <RadioIcon size={16} /> {radio.isPending ? t("menu.radioStarting") : t("menu.radio")}
        </MenuItem>

        <MenuSeparator />

        {onToggleFavorite && (
          <MenuItem onSelect={onToggleFavorite}>
            <HeartIcon size={16} className={isFavorite ? "fill-current" : undefined} />{" "}
            {isFavorite ? t("menu.unlike") : t("menu.like")}
          </MenuItem>
        )}

        <MenuSub
          label={
            <>
              <SlidersHorizontalIcon size={16} /> {t("rules.menu")}
            </>
          }
        >
          <MenuItem
            onSelect={() =>
              addRule.mutate({ action: "block", targetType: "track", targetId: track.id })
            }
          >
            {t("rules.blockTrack")}
          </MenuItem>
          <MenuItem
            onSelect={() =>
              addRule.mutate({
                action: "cooldown",
                targetType: "track",
                targetId: track.id,
                days: 30,
              })
            }
          >
            {t("rules.pauseTrack")}
          </MenuItem>
          <MenuItem
            onSelect={() =>
              addRule.mutate({ action: "downrank", targetType: "artist", targetId: track.artistId })
            }
          >
            {t("rules.downrankArtist", { artist: track.artistName })}
          </MenuItem>
          <MenuItem
            onSelect={() =>
              addRule.mutate({ action: "block", targetType: "artist", targetId: track.artistId })
            }
          >
            {t("rules.blockArtist", { artist: track.artistName })}
          </MenuItem>
        </MenuSub>

        <MenuSub
          label={
            <>
              <ListPlusIcon size={16} /> {t("menu.addToPlaylist")}
            </>
          }
        >
          <MenuItem onSelect={() => setCreatingPlaylist(true)}>
            <PlusIcon size={16} /> {t("playlists.new")}
          </MenuItem>

          {(playlists.isPending || (playlists.data?.length ?? 0) > 0) && <MenuSeparator />}
          {playlists.isPending && <Loading size="s" />}
          {playlists.data?.map((playlist) => (
            <MenuItem key={playlist.id} onSelect={stayOpen(() => addTo.mutate(playlist))}>
              <ListMusicIcon size={16} /> {playlist.name}
            </MenuItem>
          ))}
        </MenuSub>

        {playlistId && (
          <MenuItem onSelect={() => removeFromPlaylist.mutate(playlistId)}>
            <ListXIcon size={16} /> {t("menu.removeFromPlaylist")}
          </MenuItem>
        )}

        <MenuItem disabled={download.isPending} onSelect={stayOpen(() => download.mutate())}>
          <DownloadIcon size={16} />{" "}
          {download.isPending ? t("menu.downloading") : t("menu.download")}
        </MenuItem>

        <MenuSeparator />

        {track.albumId && (
          <MenuItem asChild>
            <Link href={`/albums/${track.albumId}`} onClick={onNavigate}>
              <Disc3Icon size={16} /> {t("menu.goToAlbum")}
            </Link>
          </MenuItem>
        )}

        {credits.map((artist) => (
          <MenuItem key={`go-${artist.id}`} asChild>
            <Link href={`/artists/${artist.id}`} onClick={onNavigate}>
              <UsersRoundIcon size={16} />{" "}
              {credits.length > 1
                ? t("menu.goToArtistNamed", { name: artist.name })
                : t("menu.goToArtist")}
            </Link>
          </MenuItem>
        ))}

        <MenuItem onSelect={() => void share()}>
          <Share2Icon size={16} /> {t("menu.share")}
        </MenuItem>

        <MenuItem onSelect={() => setSharingCard(true)}>
          <ImageIcon size={16} /> {t("share.card")}
        </MenuItem>

        <MenuItem onSelect={() => setShowingInfo(true)}>
          <InfoIcon size={16} /> {t("menu.trackInfo")}
        </MenuItem>

        {isAdmin && (
          <>
            <MenuSeparator />

            <MenuSub
              label={
                <>
                  <PencilIcon size={16} /> {t("menu.manage")}
                </>
              }
            >
              <MenuItem onSelect={() => setEditing(true)}>
                <PencilIcon size={16} /> {t("menu.editDetails")}
              </MenuItem>

              {credits.map((artist) => (
                <MenuItem
                  key={artist.id}
                  disabled={editArtist.isPending}
                  onSelect={stayOpen(() => editArtist.mutate(artist))}
                >
                  <UsersRoundIcon size={16} />{" "}
                  {credits.length > 1
                    ? t("menu.editArtistNamed", { name: artist.name })
                    : t("menu.editArtist")}
                </MenuItem>
              ))}

              <MenuSeparator />

              <MenuItem
                variant="destructive"
                onSelect={() =>
                  confirm({
                    title: t("menu.confirmDeleteTrack", { title: track.title }),
                    confirmLabel: t("action.delete"),
                    destructive: true,
                    action: () => deleteTrack.mutate(),
                  })
                }
              >
                <Trash2Icon size={16} /> {t("menu.deleteFromLibrary")}
              </MenuItem>
            </MenuSub>
          </>
        )}
      </MenuContent>

      {confirmDialog}

      {editing && (
        <EditTrackDialog track={track} onClose={() => setEditing(false)} onSaved={changed} />
      )}

      {showingInfo && <TrackInfoDialog track={track} onClose={() => setShowingInfo(false)} />}

      {sharingCard && <ShareCardDialog track={track} onClose={() => setSharingCard(false)} />}

      {creatingPlaylist && (
        <PlaylistDialog
          onClose={() => setCreatingPlaylist(false)}
          onSaved={() => invalidate("playlists")}
          afterCreate={async (id) => {
            await api.addToPlaylist(id, [track.id]);
            recordEvent({ type: "trackAddedToPlaylist", trackId: track.id, entityId: id });
          }}
        />
      )}

      {editingArtist && (
        <EditArtistDialog
          artist={editingArtist}
          onClose={() => setEditingArtist(null)}
          onSaved={changed}
        />
      )}
    </>
  );
}

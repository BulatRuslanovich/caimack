// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { api } from "@/lib/api";
import { recordEvent } from "@/lib/events";
import {
  CornerDownRightIcon,
  Disc3Icon,
  DownloadIcon,
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
import dynamic from "next/dynamic";
import Link from "next/link";
import { Loading } from "../Loading";

import type { TrackMenuProps } from "../TrackMenu";
import { MenuContent, MenuItem, MenuSeparator, MenuSub } from "./MenuPrimitives";
import { useTrackMenuActions } from "./useTrackMenuActions";
const EditArtistDialog = dynamic(() =>
  import("../EditArtistDialog").then((m) => m.EditArtistDialog),
);
const EditTrackDialog = dynamic(() => import("../EditTrackDialog").then((m) => m.EditTrackDialog));
const TrackInfoDialog = dynamic(() => import("../TrackInfoDialog").then((m) => m.TrackInfoDialog));
const ShareCardDialog = dynamic(() => import("../ShareCardDialog").then((m) => m.ShareCardDialog));
const PlaylistDialog = dynamic(() => import("../PlaylistDialog").then((m) => m.PlaylistDialog));

export function TrackMenuBody({
  track,
  onOpenChange,
  playlistId,
  playlistTrackIds,
  onChanged,
  isFavorite,
  onToggleFavorite,
  onNavigate,
}: Omit<TrackMenuProps, "open" | "trigger">) {
  const {
    notify,
    isAdmin,
    t,
    editing,
    setEditing,
    showingInfo,
    setShowingInfo,
    sharingCard,
    setSharingCard,
    creatingPlaylist,
    setCreatingPlaylist,
    editingArtist,
    setEditingArtist,
    confirm,
    confirmDialog,
    player,
    invalidate,
    playlists,
    addRule,
    credits,
    changed,
    stayOpen,
    addTo,
    share,
    recommendations,
    radio,
    editArtist,
    download,
    removeFromPlaylist,
    deleteTrack,
  } = useTrackMenuActions({ track, onOpenChange, playlistTrackIds, onChanged });

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

        {recommendations && (
          <MenuItem disabled={radio.isPending} onSelect={stayOpen(() => radio.mutate())}>
            <RadioIcon size={16} /> {radio.isPending ? t("menu.radioStarting") : t("menu.radio")}
          </MenuItem>
        )}

        <MenuSeparator />

        {onToggleFavorite && (
          <MenuItem onSelect={onToggleFavorite}>
            <HeartIcon size={16} className={isFavorite ? "fill-current" : undefined} />{" "}
            {isFavorite ? t("menu.unlike") : t("menu.like")}
          </MenuItem>
        )}

        {recommendations && (
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
                addRule.mutate({
                  action: "downrank",
                  targetType: "artist",
                  targetId: track.artistId,
                })
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
        )}

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

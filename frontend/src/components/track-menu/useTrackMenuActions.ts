// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/contexts/I18nContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { api } from "@/lib/api";
import { recordEvent } from "@/lib/events";
import { creditsOf, formatArtists } from "@/lib/format";
import { restoredPlaylistOrder } from "@/lib/playlistTracks";
import type { ArtistRef } from "@/lib/types";
import { useInvalidate } from "@/lib/useInvalidate";
import { useRecommendations } from "@/lib/useRecommendations";
import { useToast } from "@/lib/useToast";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { EditableArtist } from "../EditArtistDialog";
import { useConfirm } from "../ui/alert-dialog";

import type { TrackMenuProps } from "../TrackMenu";

export function useTrackMenuActions({
  track,
  onOpenChange,
  playlistTrackIds,
  onChanged,
}: Pick<TrackMenuProps, "track" | "onOpenChange" | "playlistTrackIds" | "onChanged">) {
  const { notify, notifyError } = useToast();
  const { isAdmin } = useAuth();
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [showingInfo, setShowingInfo] = useState(false);
  const [sharingCard, setSharingCard] = useState(false);
  const [editingArtist, setEditingArtist] = useState<EditableArtist | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const player = usePlayerActions();
  const invalidate = useInvalidate();
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

  const recommendations = useRecommendations();
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

  const undoRemove = useMutation({
    mutationFn: async (playlist: string) => {
      await api.changePlaylistMembership(playlist, [track.id], true);
      if (!playlistTrackIds) return;
      const latest = (await api.playlist(playlist)).tracks.map(({ id }) => id);
      const restored = restoredPlaylistOrder(latest, track.id, playlistTrackIds);
      if (restored.some((id, index) => id !== latest[index])) {
        await api.reorderPlaylist(playlist, restored);
      }
    },
    onSettled: changed,
    onError: (error) => notifyError(error, t("playlists.changeFailed")),
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

  return {
    notify,
    isAdmin,
    t,
    editing,
    setEditing,
    showingInfo,
    setShowingInfo,
    sharingCard,
    setSharingCard,
    editingArtist,
    setEditingArtist,
    confirm,
    confirmDialog,
    player,
    addRule,
    credits,
    changed,
    stayOpen,
    share,
    recommendations,
    radio,
    editArtist,
    removeFromPlaylist,
    deleteTrack,
  };
}

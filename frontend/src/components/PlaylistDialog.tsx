// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/lib/api";
import { playlistCoverUrl } from "@/lib/media";
import { limits, playlistSchema, type PlaylistValues } from "@/lib/schemas";
import type { Playlist, PlaylistDetail } from "@/lib/types";
import { useT } from "@/contexts/I18nContext";
import { FormDialog } from "./FormDialog";
import { ImagePicker, noImageChosen, type ImageChoice } from "./ImagePicker";
import { CheckboxField, TextField } from "./ui/form";
import { ListMusicIcon } from "lucide-react";

export function PlaylistDialog({
  playlist,
  onClose,
  onSaved,
  afterCreate,
  successMessage,
}: {
  playlist?: Playlist | PlaylistDetail;
  onClose: () => void;
  onSaved?: () => void;
  afterCreate?: (playlistId: string) => Promise<void>;
  successMessage?: string;
}) {
  const t = useT();
  const [cover, setCover] = useState<ImageChoice>(noImageChosen);

  const form = useForm<PlaylistValues>({
    resolver: zodResolver(playlistSchema),
    defaultValues: {
      name: playlist?.name ?? "",
      description: playlist?.description ?? "",
      isPublic: playlist?.isPublic ?? false,
    },
  });

  const save = async ({ name, description, isPublic }: PlaylistValues) => {
    if (!playlist) {
      const created = await api.createPlaylist(name, description || undefined, isPublic);
      await afterCreate?.(created.id);
      return;
    }

    const changed =
      name !== playlist.name ||
      description !== (playlist.description ?? "") ||
      isPublic !== playlist.isPublic;

    if (changed) await api.updatePlaylist(playlist.id, name, description || null, isPublic);

    if (cover.file) await api.uploadPlaylistCover(playlist.id, cover.file);
    else if (cover.removed && playlist.hasCover) await api.removePlaylistCover(playlist.id);
  };

  return (
    <FormDialog
      title={playlist ? t("dialog.editPlaylist.title") : t("playlists.new")}
      form={form}
      onClose={onClose}
      submitLabel={playlist ? undefined : t("action.create")}
      pendingLabel={playlist ? undefined : t("action.creating")}
      successMessage={
        successMessage ??
        (playlist ? t("dialog.editPlaylist.saved") : ({ name }) => t("playlists.created", { name }))
      }
      errorMessage={playlist ? t("dialog.editPlaylist.failed") : t("playlists.createFailed")}
      onSubmit={async (values) => {
        await save(values);
        onSaved?.();
      }}
    >
      {playlist && (
        <ImagePicker
          value={cover}
          onChange={setCover}
          currentUrl={playlistCoverUrl({
            playlistId: playlist.id,
            hasCover: playlist.hasCover,
            coverTrackId: playlist.coverTrackId,
          })}
          fallback={<ListMusicIcon size={34} />}
          disabled={form.formState.isSubmitting}
          kind="cover"
          name={playlist.name}
          ownImage={playlist.hasCover}
        />
      )}

      <TextField
        label={t("playlists.name")}
        registration={form.register("name")}
        error={form.formState.errors.name && t("form.required")}
        maxLength={limits.playlistName}
        autoFocus={!playlist}
      />

      <TextField
        label={t("playlists.description")}
        registration={form.register("description")}
        maxLength={limits.playlistDescription}
      />

      <CheckboxField control={form.control} name="isPublic" label={t("playlists.makePublic")} />
    </FormDialog>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { api } from "@/lib/api";
import { formatArtists } from "@/lib/format";
import { limits, trackSchema, type TrackInput, type TrackValues } from "@/lib/schemas";
import type { Track } from "@/lib/types";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { FormDialog } from "./FormDialog";
import { TextField } from "./ui/form";

export function EditTrackDialog({
  track,
  onClose,
  onSaved,
}: {
  track: Track;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const t = useT();
  const player = usePlayerActions();

  const form = useForm<TrackInput, unknown, TrackValues>({
    resolver: zodResolver(trackSchema),
    defaultValues: {
      title: track.title,
      artist: formatArtists(track),
      album: track.albumTitle ?? "",
      genre: track.genreName ?? "",
      year: track.year?.toString() ?? "",
      trackNumber: track.trackNumber?.toString() ?? "",
      discNumber: track.discNumber?.toString() ?? "",
    },
  });

  return (
    <FormDialog
      title={t("dialog.editTrack.title")}
      form={form}
      onClose={onClose}
      successMessage={t("dialog.editTrack.saved")}
      errorMessage={t("dialog.editTrack.failed")}
      onSubmit={async (values) => {
        const updated = await api.updateTrack(track.id, {
          title: values.title || track.title,
          artist: values.artist || undefined,
          album: values.album,
          genre: values.genre,
          year: values.year,
          trackNumber: values.trackNumber,
          discNumber: values.discNumber,
        });

        player.patchTrack(track.id, updated);
        onSaved?.();
      }}
    >
      <TextField
        label={t("field.title")}
        registration={form.register("title")}
        error={form.formState.errors.title && t("form.required")}
        maxLength={limits.trackTitle}
        autoFocus
      />

      <TextField
        label={t("field.artist")}
        registration={form.register("artist")}
        maxLength={limits.artistName}
      />

      <TextField
        label={t("field.album")}
        registration={form.register("album")}
        maxLength={limits.albumTitle}
      />

      <TextField
        label={t("field.genre")}
        registration={form.register("genre")}
        maxLength={limits.genreName}
      />

      <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
        <TextField
          label={t("field.year")}
          registration={form.register("year")}
          type="number"
          min={1}
          max={2999}
        />
        <TextField
          label={t("field.trackNumber")}
          registration={form.register("trackNumber")}
          type="number"
          min={0}
        />
        <TextField
          label={t("field.discNumber")}
          registration={form.register("discNumber")}
          type="number"
          min={0}
        />
      </div>

      <p className="text-sm text-muted-foreground">
        {t("dialog.editTrack.originalFile", { fileName: track.originalFileName })}
      </p>
    </FormDialog>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/lib/api";
import { artistImageUrl } from "@/lib/media";
import { initialsFor } from "@/lib/format";
import { artistSchema, limits, type ArtistValues } from "@/lib/schemas";
import { useT } from "@/contexts/I18nContext";
import { FormDialog } from "./FormDialog";
import { ImagePicker, noImageChosen, type ImageChoice } from "./ImagePicker";
import { TextField } from "./ui/form";

export interface EditableArtist {
  id: string;
  name: string;
  hasImage: boolean;
}

export function EditArtistDialog({
  artist,
  onClose,
  onSaved,
}: {
  artist: EditableArtist;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const t = useT();
  const [image, setImage] = useState<ImageChoice>(noImageChosen);

  const form = useForm<ArtistValues>({
    resolver: zodResolver(artistSchema),
    defaultValues: { name: artist.name },
  });

  const saving = form.formState.isSubmitting;

  return (
    <FormDialog
      title={t("dialog.editArtist.title")}
      form={form}
      onClose={onClose}
      successMessage={t("dialog.editArtist.saved")}
      errorMessage={t("dialog.editArtist.failed")}
      onSubmit={async ({ name }) => {
        if (name !== artist.name) await api.updateArtist(artist.id, name);

        if (image.file) await api.uploadArtistImage(artist.id, image.file);
        else if (image.removed && artist.hasImage) await api.removeArtistImage(artist.id);

        onSaved?.();
      }}
    >
      <ImagePicker
        value={image}
        onChange={setImage}
        currentUrl={artistImageUrl({ artistId: artist.id, hasImage: artist.hasImage })}
        fallback={<span aria-hidden="true">{initialsFor(artist.name)}</span>}
        disabled={saving}
        kind="photo"
        name={artist.name}
      />

      <TextField
        label={t("field.name")}
        registration={form.register("name")}
        error={form.formState.errors.name && t("form.required")}
        maxLength={limits.artistName}
      />
    </FormDialog>
  );
}

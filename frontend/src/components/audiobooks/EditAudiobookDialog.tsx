// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BookHeadphonesIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { FormDialog } from "@/components/FormDialog";
import { ImagePicker, noImageChosen, type ImageChoice } from "@/components/ImagePicker";
import { TextField } from "@/components/ui/form";
import { useT } from "@/contexts/I18nContext";
import { audiobookApi, type Audiobook } from "@/lib/audiobooks";
import {
  audiobookSchema,
  limits,
  yearRange,
  type AudiobookInput,
  type AudiobookValues,
} from "@/lib/schemas";

export function EditAudiobookDialog({
  book,
  onClose,
  onSaved,
}: {
  book: Audiobook;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [cover, setCover] = useState<ImageChoice>(noImageChosen);
  const form = useForm<AudiobookInput, unknown, AudiobookValues>({
    resolver: zodResolver(audiobookSchema),
    defaultValues: {
      title: book.title,
      author: book.author ?? "",
      narrator: book.narrator ?? "",
      year: book.year?.toString() ?? "",
    },
  });

  return (
    <FormDialog
      title={t("dialog.editAudiobook.title")}
      form={form}
      onClose={onClose}
      successMessage={t("dialog.editAudiobook.saved")}
      errorMessage={t("dialog.editAudiobook.failed")}
      onSubmit={async (values) => {
        await audiobookApi.edit(book.id, values, cover.file, cover.removed);
        onSaved();
      }}
    >
      <ImagePicker
        value={cover}
        onChange={setCover}
        currentUrl={book.coverUrl}
        fallback={<BookHeadphonesIcon size={32} aria-hidden="true" />}
        disabled={form.formState.isSubmitting}
        kind="cover"
        name={book.title}
      />

      <TextField
        label={t("field.title")}
        registration={form.register("title")}
        error={form.formState.errors.title && t("form.required")}
        maxLength={limits.albumTitle}
        autoFocus
      />

      <TextField
        label={t("field.author")}
        registration={form.register("author")}
        maxLength={limits.artistName}
      />

      <TextField
        label={t("field.narrator")}
        registration={form.register("narrator")}
        maxLength={limits.artistName}
      />

      <TextField
        label={t("field.year")}
        registration={form.register("year")}
        error={form.formState.errors.year && t("form.year", yearRange)}
        type="number"
        min={yearRange.min}
        max={yearRange.max}
      />
    </FormDialog>
  );
}

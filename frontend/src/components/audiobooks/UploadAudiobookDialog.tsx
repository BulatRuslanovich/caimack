// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { FormDialog } from "@/components/FormDialog";
import { TextField } from "@/components/ui/form";
import { useT } from "@/contexts/I18nContext";
import { audiobookApi } from "@/lib/audiobooks";
import { extensionOf } from "@/lib/playback/audioFormats";
import { limits } from "@/lib/schemas";

const extensions = [".mp3", ".flac", ".m4a", ".m4b", ".ogg", ".oga", ".opus", ".wav"];
const maxUploadBytes = 2 * 1024 ** 3;

export function UploadAudiobookDialog({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: () => void;
}) {
  const t = useT();
  const [uploadId, setUploadId] = useState<string | null>(null);
  const form = useForm<{ title: string; files: FileList }>({ defaultValues: { title: "" } });
  const { errors, isSubmitting } = form.formState;
  const resetUploadId = () => setUploadId(null);

  return (
    <FormDialog
      title={t("audiobooks.upload")}
      description={t("audiobooks.uploadHint")}
      form={form}
      onClose={onClose}
      submitLabel={t("audiobooks.upload")}
      pendingLabel={t("audiobooks.uploading")}
      successMessage={t("audiobooks.uploaded")}
      errorMessage={t("audiobooks.uploadFailed")}
      onSubmit={async ({ title, files }) => {
        const id = uploadId ?? crypto.randomUUID();
        setUploadId(id);
        await audiobookApi.upload(id, title.trim(), Array.from(files));
        onUploaded();
      }}
    >
      <TextField
        label={t("field.title")}
        registration={form.register("title", {
          validate: (title) => !!title.trim() || t("form.required"),
          onChange: resetUploadId,
        })}
        error={errors.title?.message}
        maxLength={limits.albumTitle}
        disabled={isSubmitting}
        autoFocus
      />
      <TextField
        label={t("audiobooks.chapters")}
        hint={t("upload.formats", { formats: extensions.join(", ") })}
        registration={form.register("files", {
          required: t("audiobooks.uploadFilesRequired"),
          validate: {
            format: (files) =>
              Array.from(files).every((file) => extensions.includes(extensionOf(file.name))) ||
              t("audiobooks.uploadFormat"),
            size: (files) =>
              Array.from(files).reduce((bytes, file) => bytes + file.size, 0) < maxUploadBytes ||
              t("audiobooks.uploadTooLarge"),
          },
          onChange: resetUploadId,
        })}
        error={errors.files?.message}
        type="file"
        accept={extensions.join(",")}
        multiple
        disabled={isSubmitting}
      />
    </FormDialog>
  );
}

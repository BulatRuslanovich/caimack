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
  const [progress, setProgress] = useState(0);
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
      pendingLabel={t(progress === 100 ? "audiobooks.readingChapters" : "audiobooks.uploading")}
      successMessage={t("audiobooks.uploaded")}
      errorMessage={t("audiobooks.uploadFailed")}
      onSubmit={async ({ title, files }) => {
        const id = uploadId ?? crypto.randomUUID();
        setUploadId(id);
        try {
          await audiobookApi.upload(id, title.trim(), Array.from(files), setProgress);
          onUploaded();
        } finally {
          setProgress(0);
        }
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
      {isSubmitting && (
        <div className="flex items-center gap-3">
          <progress
            aria-label={t("audiobooks.uploadProgress")}
            className="h-2 w-full accent-primary"
            max={100}
            value={progress}
          />
          <span className="text-sm tabular-nums text-muted-foreground">{progress}%</span>
        </div>
      )}
    </FormDialog>
  );
}

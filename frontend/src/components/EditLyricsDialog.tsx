// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { api } from "@/lib/api";
import { toLrc } from "@/lib/lyrics";
import { limits, lyricsSchema, type LyricsValues } from "@/lib/schemas";
import type { Lyrics, Track } from "@/lib/types";
import { useT } from "@/contexts/I18nContext";
import { FormDialog } from "./FormDialog";
import { TextAreaField } from "./ui/form";

export function EditLyricsDialog({
  track,
  lyrics,
  onClose,
  onSaved,
}: {
  track: Track;
  lyrics: Lyrics | null;
  onClose: () => void;
  onSaved: (saved: Lyrics | null) => void;
}) {
  const t = useT();

  const form = useForm<LyricsValues>({
    resolver: zodResolver(lyricsSchema),
    defaultValues: { text: lyrics ? toLrc(lyrics) : "" },
  });

  return (
    <FormDialog
      title={t("lyrics.edit")}
      description={track.title}
      form={form}
      onClose={onClose}
      successMessage={t("lyrics.saved")}
      errorMessage={t("lyrics.saveFailed")}
      onSubmit={async ({ text }) => {
        onSaved((await api.updateLyrics(track.id, text)) ?? null);
      }}
    >
      <TextAreaField
        label={t("lyrics.title")}
        registration={form.register("text")}
        error={form.formState.errors.text && t("form.tooLong")}
        maxLength={limits.lyrics}
        rows={14}
        spellCheck={false}
        className="[&>textarea]:font-mono"
      />
    </FormDialog>
  );
}

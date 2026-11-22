// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { Close as DialogClose, Trigger as DialogTrigger } from "@radix-ui/react-dialog";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/form";
import { useT } from "@/contexts/I18nContext";
import { YandexImportRow } from "./YandexImports";
import { useYandexImports, yandexSourceKey, type YandexSource } from "./YandexMusicContext";

function playlistLink(input: string): string | undefined {
  try {
    const url = new URL(input.trim());
    if (url.origin !== "https://music.yandex.ru" || url.username || url.password) return;
    const path = url.pathname.replace(/\/+$/, "");
    if (/^\/(?:playlists\/[^/]+|users\/[^/]+\/playlists\/\d+)$/.test(path)) {
      return url.origin + path;
    }
  } catch {
    return;
  }
}

export function YandexPlaylistImport() {
  const t = useT();
  const { jobs, start, errors } = useYandexImports();
  const [submitted, setSubmitted] = useState<string>();
  const [jobId, setJobId] = useState<string>();
  const formId = useId();
  const form = useForm<{ link: string }>({ defaultValues: { link: "" } });
  const job = jobs.find((entry) => entry.id === jobId);
  const error = submitted ? errors[submitted] : undefined;
  const submit = form.handleSubmit(async ({ link }) => {
    const id = playlistLink(link);
    if (!id) return;
    const source: YandexSource = { kind: "Playlist", id, title: t("yandex.playlist.import") };
    setSubmitted(yandexSourceKey(source));
    const started = await start(source);
    if (started) setJobId(started.id);
  });

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open && !form.formState.isSubmitting) {
          form.reset();
          setSubmitted(undefined);
          setJobId(undefined);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">{t("yandex.playlist.import")}</Button>
      </DialogTrigger>
      <DialogContent
        title={t("yandex.playlist.import")}
        description={t("yandex.playlist.hint")}
        footer={
          job ? (
            <DialogClose asChild>
              <Button>{t("action.close")}</Button>
            </DialogClose>
          ) : (
            <Button
              type="submit"
              form={formId}
              variant="primary"
              disabled={form.formState.isSubmitting}
            >
              {t("yandex.playlist.import")}
            </Button>
          )
        }
      >
        {job ? (
          <YandexImportRow job={job} onRetry={setJobId} />
        ) : (
          <form id={formId} onSubmit={(event) => void submit(event)} noValidate>
            <TextField
              type="url"
              autoComplete="off"
              maxLength={2048}
              label={t("yandex.playlist.link")}
              placeholder="https://music.yandex.ru/playlists/…"
              disabled={form.formState.isSubmitting}
              error={form.formState.errors.link?.message ?? error}
              registration={form.register("link", {
                onChange: () => setSubmitted(undefined),
                validate: (value) =>
                  Boolean(playlistLink(value)) || t("yandex.playlist.invalidLink"),
              })}
            />
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

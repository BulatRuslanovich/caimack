// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useMutation } from "@tanstack/react-query";
import { ListMusicIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/form";
import { useT } from "@/contexts/I18nContext";
import { useInvalidate } from "@/lib/useInvalidate";
import { VkMusicError } from "@/lib/vkMusic";
import { importVkPlaylist, vkPlaylistSource } from "@/lib/vkPlaylist";

export function VkPlaylistImport({
  disabled,
  onImporting,
}: {
  disabled: boolean;
  onImporting: (active: boolean) => void;
}) {
  const t = useT();
  const invalidate = useInvalidate();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; title: string }>();
  const form = useForm<{ link: string }>({ defaultValues: { link: "" } });
  const job = useMutation({
    meta: { handlesError: true },
    mutationFn: (source: string) => importVkPlaylist(source, setProgress),
    onMutate: () => {
      setProgress(undefined);
      onImporting(true);
    },
    onSettled: () => {
      onImporting(false);
      invalidate("library", "playlists");
    },
  });
  const submit = form.handleSubmit(({ link }) => {
    const source = vkPlaylistSource(link);
    if (source && !job.isPending) job.mutate(source);
  });
  const result = job.data;
  const issueCount = (result?.skipped.length ?? 0) + (result?.omitted ?? 0);

  return (
    <>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
        <ListMusicIcon size={16} aria-hidden />
        {t("vkMusic.playlist.import")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value && !job.isPending) {
            job.reset();
            form.reset();
          }
        }}
      >
        <DialogContent
          title={t("vkMusic.playlist.import")}
          description={t("vkMusic.playlist.hint")}
          footer={
            result?.playlist ? (
              <Button asChild variant="primary">
                <Link href={`/playlists/${result.playlist.id}`}>{t("vkMusic.playlist.open")}</Link>
              </Button>
            ) : (
              <Button type="submit" form={formId} variant="primary" disabled={job.isPending}>
                {t("vkMusic.playlist.import")}
              </Button>
            )
          }
        >
          <div className="space-y-4">
            {!result?.playlist && (
              <form id={formId} onSubmit={(event) => void submit(event)} noValidate>
                <TextField
                  type="url"
                  autoComplete="off"
                  label={t("vkMusic.playlist.link")}
                  placeholder="https://vk.ru/music/playlist/…"
                  disabled={job.isPending}
                  registration={form.register("link", {
                    validate: (value) =>
                      Boolean(vkPlaylistSource(value)) || t("vkMusic.playlist.invalidLink"),
                  })}
                  error={form.formState.errors.link?.message}
                />
              </form>
            )}
            {job.isPending && (
              <p role="status" className="text-sm text-muted-foreground">
                {progress
                  ? t("vkMusic.playlist.progress", progress)
                  : t("vkMusic.playlist.loading")}
              </p>
            )}
            {job.error && (
              <p role="alert" className="text-sm text-destructive">
                {job.error instanceof VkMusicError
                  ? t(`vkMusic.error.${job.error.code}`)
                  : job.error.message}
              </p>
            )}
            {result && (
              <div role="status" className="space-y-2 text-sm">
                <p>
                  {result.playlist
                    ? t("vkMusic.playlist.created", {
                        name: result.playlist.name,
                        count: result.playlist.trackCount,
                      })
                    : t("vkMusic.playlist.empty")}
                </p>
                {issueCount > 0 && (
                  <p className="text-muted-foreground">
                    {t("vkMusic.playlist.skipped", { count: issueCount })}
                  </p>
                )}
                {result.skipped.length > 0 && (
                  <ul className="max-h-40 list-disc overflow-y-auto ps-5 text-muted-foreground">
                    {result.skipped.map((track, index) => (
                      <li key={index}>{track}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

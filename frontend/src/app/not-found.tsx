// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { MusicIcon } from "lucide-react";
import { StatusPage } from "@/components/StatusPage";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useT } from "@/contexts/I18nContext";
import { usePlayerActions } from "@/contexts/PlayerContext";

export default function NotFound() {
  const t = useT();
  const { playTrack } = usePlayerActions();

  const playAnything = useMutation({
    mutationFn: () => api.shuffleTracks({ limit: 1 }),
    onSuccess: ([track]) => {
      if (track) playTrack(track, [track]);
    },
  });

  return (
    <StatusPage
      icon={<MusicIcon size={32} />}
      title={t("error.notFoundTitle")}
      description={t("error.notFoundDescription")}
      actions={
        <>
          <Button variant="primary" asChild>
            <Link href="/">{t("action.goHome")}</Link>
          </Button>
          <Button onClick={() => playAnything.mutate()} disabled={playAnything.isPending}>
            {t("error.notFoundPlayAnyway")}
          </Button>
        </>
      }
    />
  );
}

// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ListMusicIcon } from "lucide-react";
import { useT } from "@/contexts/I18nContext";
import { queries } from "@/lib/queries";
import type { PlaylistTrackChanges } from "@/lib/types";
import { useInvalidate } from "@/lib/useInvalidate";
import { useToast } from "@/lib/useToast";
import { Loading } from "./Loading";
import { PlaylistActionDialog, type ReturnFocus } from "./PlaylistActionDialog";
import { LoadError, Query } from "./Query";
import { Button } from "./ui/button";

export function PlaylistDestinationDialog({
  sourceId,
  title,
  onChoose,
  onClose,
  onDone,
  returnFocus,
}: {
  sourceId: string;
  title: string;
  onChoose: (destinationId: string) => Promise<PlaylistTrackChanges>;
  onClose: () => void;
  onDone?: () => void;
  returnFocus: ReturnFocus;
}) {
  const t = useT();
  const { notify } = useToast();
  const invalidate = useInvalidate();
  const playlists = useQuery(queries.playlists());
  const save = useMutation({
    mutationFn: onChoose,
    onSuccess: ({ changed, unchanged }) => {
      invalidate("playlists");
      notify(t("playlists.copyResult", { changed, unchanged }), "success");
      onDone?.();
      onClose();
    },
  });

  return (
    <PlaylistActionDialog
      title={title}
      onClose={onClose}
      returnFocus={returnFocus}
      busy={save.isPending}
      footer={
        <Button variant="outline" onClick={onClose} disabled={save.isPending}>
          {t("action.cancel")}
        </Button>
      }
    >
      {save.isError && (
        <LoadError
          message={t("playlists.changeFailed")}
          onRetry={() => save.mutate(save.variables)}
        />
      )}
      {save.isPending && <Loading size="s" label={t("action.saving")} />}
      <Query result={playlists} skeleton={<Loading size="s" />}>
        {(items) => {
          const destinations = items.filter((playlist) => playlist.id !== sourceId);
          return destinations.length ? (
            <div className="flex flex-col">
              {destinations.map((playlist) => (
                <Button
                  key={playlist.id}
                  variant="ghost"
                  className="h-auto min-h-11 justify-start py-2 text-left whitespace-normal"
                  disabled={save.isPending}
                  onClick={() => save.mutate(playlist.id)}
                >
                  <ListMusicIcon size={16} />{" "}
                  <span className="min-w-0 break-words">{playlist.name}</span>
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("playlists.noDestinations")}</p>
          );
        }}
      </Query>
    </PlaylistActionDialog>
  );
}

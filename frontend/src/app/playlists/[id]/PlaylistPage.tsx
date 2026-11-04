// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { playlistCoverUrl } from "@/lib/media";
import { queries } from "@/lib/queries";
import { useFormat } from "@/lib/useFormat";
import { useInvalidate } from "@/lib/useInvalidate";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/lib/useToast";
import { CoverMosaic, mosaicBackdrop } from "@/components/collection/CoverMosaic";
import { PlaylistCover } from "@/components/Cover";
import { DetailHeader } from "@/components/DetailHeader";
import { PlayAllButton } from "@/components/PlayAllButton";
import { EmptyState } from "@/components/EmptyState";
import { Query } from "@/components/Query";
import { TrackList } from "@/components/TrackList";
import { useConfirm } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ListMusicIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useT } from "@/contexts/I18nContext";
import { Section } from "@/components/PageHeader";

const PlaylistDialog = dynamic(() =>
  import("@/components/PlaylistDialog").then((m) => m.PlaylistDialog),
);

export function PlaylistPage() {
  const t = useT();
  const format = useFormat();

  const id = useParams<{ id: string }>().id;
  const router = useRouter();
  const client = useQueryClient();
  const invalidate = useInvalidate();
  const { notify } = useToast();
  const { user } = useAuth();
  const [confirm, confirmDialog] = useConfirm();

  const playlist = useQuery(queries.playlist(id));

  const [editing, setEditing] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.deletePlaylist(id),
    onSuccess: () => {
      notify(t("playlists.deleted"), "success");
      invalidate("playlists");
      router.push("/playlists");
    },
  });

  const key = queries.playlist(id).queryKey;

  const reorder = useMutation({
    mutationFn: (trackIds: string[]) => api.reorderPlaylist(id, trackIds),
    onMutate: (trackIds) =>
      client.setQueryData(key, (current) =>
        current
          ? {
              ...current,
              tracks: trackIds
                .map((trackId) => current.tracks.find((track) => track.id === trackId))
                .filter((track): track is NonNullable<typeof track> => Boolean(track)),
            }
          : current,
      ),
    onError: () => client.invalidateQueries({ queryKey: key }),
  });

  return (
    <Query result={playlist}>
      {(detail) => {
        const isOwner = user?.id === detail.ownerId;

        return (
          <>
            <DetailHeader
              kind={t("playlists.kind")}
              title={detail.name}
              description={detail.description || undefined}
              backdrop={
                detail.hasCover || detail.tracks.length < 4
                  ? playlistCoverUrl({
                      playlistId: detail.id,
                      hasCover: detail.hasCover,
                      coverTrackId: detail.coverTrackId,
                      variant: "thumb",
                    })
                  : mosaicBackdrop(detail.tracks)
              }
              art={
                detail.hasCover || detail.tracks.length < 4 ? (
                  <PlaylistCover
                    playlist={detail}
                    variant="full"
                    sizes="(min-width: 56.25rem) 280px, 128px"
                    fallback={<ListMusicIcon size={48} />}
                  />
                ) : (
                  <CoverMosaic tracks={detail.tracks} />
                )
              }
              facts={[
                !isOwner && t("playlists.by", { name: detail.ownerName }),
                t("count.tracks", { count: detail.tracks.length }),
                detail.durationSeconds > 0 && format.totalDuration(detail.durationSeconds),
                isOwner && detail.isPublic && (
                  <Badge key="public">{t("playlists.publicBadge")}</Badge>
                ),
              ]}
              actions={
                <>
                  <PlayAllButton tracks={detail.tracks} name={detail.name} />
                  {isOwner && (
                    <>
                      <Button onClick={() => setEditing(true)}>
                        <PencilIcon size={16} /> {t("action.edit")}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() =>
                          confirm({
                            title: t("playlists.confirmDelete", { name: detail.name }),
                            confirmLabel: t("action.delete"),
                            destructive: true,
                            action: () => remove.mutate(),
                          })
                        }
                      >
                        <Trash2Icon size={16} /> {t("action.delete")}
                      </Button>
                    </>
                  )}
                </>
              }
            />

            {detail.tracks.length === 0 ? (
              <EmptyState
                icon={<ListMusicIcon size={24} />}
                title={t("playlists.emptyPlaylistTitle")}
              />
            ) : (
              <Section title={t("albums.tracks")}>
                <TrackList
                  tracks={detail.tracks}
                  playlistId={isOwner ? id : undefined}
                  onReorder={isOwner ? reorder.mutate : undefined}
                />
              </Section>
            )}

            {editing && isOwner && (
              <PlaylistDialog
                playlist={detail}
                onClose={() => setEditing(false)}
                onSaved={() => invalidate("playlists")}
              />
            )}

            {confirmDialog}
          </>
        );
      }}
    </Query>
  );
}

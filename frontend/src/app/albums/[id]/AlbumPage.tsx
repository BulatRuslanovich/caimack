// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { coverUrl } from "@/lib/media";
import { queries } from "@/lib/queries";
import { uniformAudioSpec } from "@/lib/format";
import { useFormat } from "@/lib/useFormat";
import { useEntityOpened } from "@/lib/useEntityOpened";
import { useInvalidate } from "@/lib/useInvalidate";
import { DetailHeader } from "@/components/DetailHeader";
import { Record } from "@/components/Record";
import { PencilIcon } from "lucide-react";
import { AlbumCard } from "@/components/MediaCard";
import { Section } from "@/components/PageHeader";
import { Shelf } from "@/components/Shelf";
import { PlayAllButton } from "@/components/PlayAllButton";
import { RadioButton } from "@/components/RadioButton";
import { ShuffleButton } from "@/components/ShuffleButton";
import { Query } from "@/components/Query";
import { TrackList } from "@/components/TrackList";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { usePlayerState } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";

const EditAlbumDialog = dynamic(() =>
  import("@/components/EditAlbumDialog").then((m) => m.EditAlbumDialog),
);

export function AlbumPage() {
  const t = useT();
  const format = useFormat();
  const { isAdmin } = useAuth();
  const invalidate = useInvalidate();
  const player = usePlayerState();

  const id = useParams<{ id: string }>().id;
  const [editing, setEditing] = useState(false);
  const album = useQuery(queries.album(id));

  useEntityOpened("albumOpened", id);

  const data = album.data;

  const artistId = data?.artistId;
  const siblings = useQuery({
    ...queries.albums({ artistId, page: 1, pageSize: 12 }),
    enabled: artistId !== undefined,
  });

  const more = (siblings.data?.items ?? []).filter((album) => album.id !== id);

  const tracks = data?.tracks ?? [];

  const hasFeatures = tracks.some((track) => track.artistId !== data?.artistId);
  const albumSpec = uniformAudioSpec(tracks);

  return (
    <Query result={album}>
      {(detail) => (
        <>
          <DetailHeader
            kind={t("albums.kind")}
            title={detail.title}
            record
            backdrop={coverUrl({ albumId: detail.id, hasCover: detail.hasCover, variant: "thumb" })}
            art={
              <Record
                track={{
                  id: detail.id,
                  title: detail.title,
                  albumId: detail.id,
                  albumTitle: detail.title,
                  hasCover: detail.hasCover,
                }}
                out
                spinning={
                  player.isPlaying &&
                  !player.buffering &&
                  player.currentTrack?.albumId === detail.id
                }
                sizes="(min-width: 56.25rem) 288px, 224px"
                className={
                  player.currentTrack?.albumId === detail.id
                    ? "size-full [--record-out:30%]"
                    : "size-full [--record-out:22%]"
                }
              />
            }
            facts={[
              <Link
                key="artist"
                href={`/artists/${detail.artistId}`}
                className="font-medium text-foreground"
              >
                {detail.artistName}
              </Link>,
              detail.year,
              t("count.tracks", { count: detail.tracks.length }),
              detail.durationSeconds > 0 && format.totalDuration(detail.durationSeconds),
              albumSpec,
            ]}
            actions={
              <>
                <PlayAllButton tracks={detail.tracks} name={detail.title} />
                {detail.tracks.length > 1 && <ShuffleButton tracks={detail.tracks} />}
                {detail.tracks.length > 0 && <RadioButton seed={detail.tracks[0]} />}
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditing(true)}
                    aria-label={t("action.edit")}
                    title={t("action.edit")}
                  >
                    <PencilIcon size={18} />
                  </Button>
                )}
              </>
            }
          />

          <Section title={t("albums.tracks")}>
            <TrackList
              tracks={detail.tracks}
              showAlbum={false}
              showCover={false}
              showArtist={hasFeatures}
              showAudioSpec={albumSpec === null}
              useTrackNumbers
            />
          </Section>

          {more.length > 0 && (
            <Shelf
              title={t("albums.moreByArtist", { name: detail.artistName })}
              href={`/artists/${detail.artistId}`}
            >
              {more.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </Shelf>
          )}

          {editing && (
            <EditAlbumDialog
              album={{
                id: detail.id,
                title: detail.title,
                artistName: detail.artistName,
                year: detail.year,
                hasCover: detail.hasCover,
              }}
              onClose={() => setEditing(false)}
              onSaved={() => invalidate("library")}
            />
          )}
        </>
      )}
    </Query>
  );
}

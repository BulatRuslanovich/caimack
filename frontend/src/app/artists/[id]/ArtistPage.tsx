// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { artistImageUrl } from "@/lib/media";
import { queries } from "@/lib/queries";
import { useEntityOpened } from "@/lib/useEntityOpened";
import { useInvalidate } from "@/lib/useInvalidate";
import { usePage } from "@/lib/usePage";
import { RankedList } from "@/components/collection/RankedList";
import { ArtistCover } from "@/components/Cover";
import { DetailHeader } from "@/components/DetailHeader";
import { AlbumCard } from "@/components/MediaCard";
import { CardGrid, Section } from "@/components/PageHeader";
import { Shelf } from "@/components/Shelf";
import { Pagination } from "@/components/PageToolbar";
import { PlayAllButton } from "@/components/PlayAllButton";
import { RadioButton } from "@/components/RadioButton";
import { ShuffleButton } from "@/components/ShuffleButton";
import { Query } from "@/components/Query";
import { TrackList } from "@/components/TrackList";
import { Button } from "@/components/ui/button";
import { PencilIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/contexts/I18nContext";

const EditArtistDialog = dynamic(() =>
  import("@/components/EditArtistDialog").then((m) => m.EditArtistDialog),
);

const GRID_THRESHOLD = 6;

export function ArtistPage() {
  const t = useT();
  const { isAdmin } = useAuth();
  const invalidate = useInvalidate();

  const id = useParams<{ id: string }>().id;
  const [page, setPage] = usePage([id]);
  const [editing, setEditing] = useState(false);

  useEntityOpened("artistOpened", id);

  const artist = useQuery(queries.artist(id, page));
  const top = useQuery(queries.artistTopTracks(id));

  const topTracks = top.data ?? [];

  const showTop = topTracks.length > 0 && (artist.data?.tracks.total ?? 0) > topTracks.length;

  return (
    <Query result={artist}>
      {(detail) => (
        <>
          <DetailHeader
            kind={t("artists.kind")}
            title={detail.name}
            round
            backdrop={artistImageUrl({
              artistId: detail.id,
              hasImage: detail.hasImage,
              variant: "thumb",
            })}
            art={
              <ArtistCover
                artist={detail}
                variant="full"
                sizes="(min-width: 56.25rem) 280px, 128px"
              />
            }
            facts={[
              detail.albums.length > 0 && t("count.albums", { count: detail.albums.length }),
              t("count.tracks", { count: detail.tracks.total }),
            ]}
            actions={
              <>
                <PlayAllButton tracks={detail.tracks.items} name={detail.name} />
                {detail.tracks.items.length > 1 && <ShuffleButton tracks={detail.tracks.items} />}
                {detail.tracks.items.length > 0 && (
                  <RadioButton seed={topTracks[0] ?? detail.tracks.items[0]} />
                )}
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

          {showTop && (
            <Section title={t("artists.topTracks")}>
              <RankedList tracks={topTracks} showArtist={false} />
            </Section>
          )}

          {detail.albums.length > 0 &&
            (detail.albums.length < GRID_THRESHOLD ? (
              <Shelf title={t("artists.discography")}>
                {detail.albums.map((album) => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </Shelf>
            ) : (
              <Section title={t("artists.discography")}>
                <CardGrid>
                  {detail.albums.map((album) => (
                    <AlbumCard key={album.id} album={album} />
                  ))}
                </CardGrid>
              </Section>
            ))}

          <Section title={t("nav.tracks")}>
            <TrackList tracks={detail.tracks.items} showArtist={false} />
            <Pagination result={detail.tracks} onChange={setPage} />
          </Section>

          {editing && (
            <EditArtistDialog
              artist={{ id: detail.id, name: detail.name, hasImage: detail.hasImage }}
              onClose={() => setEditing(false)}
              onSaved={() => invalidate("library")}
            />
          )}
        </>
      )}
    </Query>
  );
}

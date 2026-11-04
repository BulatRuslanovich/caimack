// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { genreName } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { TagsIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { TRACK_PAGE_SIZE } from "@/lib/pageSizes";
import { coverUrl } from "@/lib/media";
import { queries } from "@/lib/queries";
import { smoothUnlessReduced } from "@/lib/scroll";
import { usePage } from "@/lib/usePage";
import type { Genre } from "@/lib/types";
import { AlbumMosaic } from "@/components/collection/CoverMosaic";
import { Card } from "@/components/MediaCard";
import { CardGrid, PageHeader, Section } from "@/components/PageHeader";
import { Pagination } from "@/components/PageToolbar";
import { PlayAllButton } from "@/components/PlayAllButton";
import { Query } from "@/components/Query";
import { TrackList } from "@/components/TrackList";
import { useT } from "@/contexts/I18nContext";

export function GenresPage() {
  const t = useT();

  return (
    <Suspense fallback={<PageHeader title={t("nav.genres")} />}>
      <GenresView />
    </Suspense>
  );
}

function GenresView() {
  const t = useT();

  const initial = useSearchParams().get("id");
  const [selected, setSelected] = useState<string | null>(initial);
  const [page, setPage] = usePage([selected]);

  const tracksRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (selected === null) return;

    tracksRef.current?.scrollIntoView({
      block: "start",
      behavior: smoothUnlessReduced(),
    });
  }, [selected]);

  const genres = useQuery(queries.genres());
  const tracks = useQuery(queries.genreTracks(selected, { page, pageSize: TRACK_PAGE_SIZE }));

  const selectedGenre = genres.data?.find((genre) => genre.id === selected) ?? null;

  return (
    <>
      <PageHeader
        title={t("nav.genres")}
        subtitle={genres.data ? t("count.genres", { count: genres.data.length }) : undefined}
        actions={
          tracks.data && tracks.data.items.length > 0 ? (
            <PlayAllButton tracks={tracks.data.items} />
          ) : undefined
        }
      />

      <Query result={genres} empty={{ icon: <TagsIcon size={24} />, title: t("genres.empty") }}>
        {(list) => (
          <CardGrid>
            {list.map((genre) => (
              <GenreCard
                key={genre.id}
                genre={genre}
                active={selected === genre.id}
                onSelect={() => setSelected(selected === genre.id ? null : genre.id)}
              />
            ))}
          </CardGrid>
        )}
      </Query>

      {selectedGenre ? (
        <Section title={genreName(selectedGenre.name)} ref={tracksRef}>
          <Query result={tracks}>
            {(result) =>
              result === null ? null : (
                <>
                  <TrackList tracks={result.items} />
                  <Pagination result={result} onChange={setPage} />
                </>
              )
            }
          </Query>
        </Section>
      ) : null}
    </>
  );
}

function GenreCard({
  genre,
  active,
  onSelect,
}: {
  genre: Genre;
  active: boolean;
  onSelect: () => void;
}) {
  const t = useT();

  return (
    <Card
      onClick={onSelect}
      active={active}
      current={active}
      title={genreName(genre.name)}
      subtitle={t("count.tracks", { count: genre.trackCount })}
      cover={<AlbumMosaic albumIds={genre.coverAlbumIds} name={genre.name} />}
      toneSrc={genre.coverAlbumIds.map((id) => coverUrl({ albumId: id, variant: "thumb" }))}
    />
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { genreName } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { TagsIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { TRACK_PAGE_SIZE } from "@/lib/pageSizes";
import { coverUrl } from "@/lib/media";
import { queries } from "@/lib/queries";
import { smoothUnlessReduced } from "@/lib/scroll";
import { usePage } from "@/lib/usePage";
import type { Genre } from "@/lib/types";
import { AlbumMosaic } from "@/components/collection/CoverMosaic";
import { Card } from "@/components/MediaCard";
import { CardGrid, CardGridSkeleton, PageHeader, Section } from "@/components/PageHeader";
import { Pagination } from "@/components/PageToolbar";
import { PlayAllButton } from "@/components/PlayAllButton";
import { Query } from "@/components/Query";
import { TrackList } from "@/components/TrackList";
import { useT } from "@/contexts/I18nContext";

export function GenresPage({
  query,
  selected,
  onSelect,
}: {
  query: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const t = useT();

  const [page, setPage] = usePage([selected]);

  const tracksRef = useRef<HTMLElement>(null);

  const genres = useQuery(queries.genres());
  const tracks = useQuery(queries.genreTracks(selected, { page, pageSize: TRACK_PAGE_SIZE }));
  const term = query.toLocaleLowerCase();
  const matching = term
    ? genres.data?.filter(
        ({ name }) =>
          name.toLocaleLowerCase().includes(term) ||
          genreName(name).toLocaleLowerCase().includes(term),
      )
    : genres.data;
  const selectedGenre = matching?.find((genre) => genre.id === selected);

  useEffect(() => {
    if (selectedGenre)
      tracksRef.current?.scrollIntoView({ block: "start", behavior: smoothUnlessReduced() });
  }, [selectedGenre]);

  return (
    <div className="flex min-w-0 flex-col gap-6 max-md:gap-5">
      <PageHeader
        subtitle={matching && t("count.genres", { count: matching.length })}
        actions={
          tracks.data && tracks.data.items.length > 0 ? (
            <PlayAllButton tracks={tracks.data.items} />
          ) : undefined
        }
      />

      <Query
        result={genres}
        isEmpty={() => !matching?.length}
        skeleton={<CardGridSkeleton />}
        empty={{
          icon: <TagsIcon size={24} />,
          title: t(query ? "search.nothingFound" : "genres.empty"),
        }}
      >
        {() => (
          <CardGrid>
            {matching?.map((genre) => (
              <GenreCard
                key={genre.id}
                genre={genre}
                active={selected === genre.id}
                onSelect={() => onSelect(selected === genre.id ? null : genre.id)}
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
    </div>
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

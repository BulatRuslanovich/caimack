// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { TRACK_PAGE_SIZE } from "@/lib/pageSizes";
import { queries } from "@/lib/queries";
import { useFormat } from "@/lib/useFormat";
import { usePage } from "@/lib/usePage";
import { CoverMosaic, mosaicBackdrop } from "@/components/collection/CoverMosaic";
import { DetailHeader } from "@/components/DetailHeader";
import { Pagination } from "@/components/PageToolbar";
import { PlayAllButton } from "@/components/PlayAllButton";
import { Query } from "@/components/Query";
import { TrackList } from "@/components/TrackList";
import { Button } from "@/components/ui/button";
import { HeartIcon } from "lucide-react";
import { useT } from "@/contexts/I18nContext";

export function FavoritesPage() {
  const t = useT();
  const format = useFormat();

  const [page, setPage] = usePage([]);
  const favorites = useQuery(queries.favorites({ page, pageSize: TRACK_PAGE_SIZE }));

  const data = favorites.data;
  const items = data?.items ?? [];

  const wholeListLoaded = data !== undefined && data.total <= items.length;
  const totalDuration = wholeListLoaded
    ? items.reduce((sum, track) => sum + track.durationSeconds, 0)
    : 0;

  return (
    <>
      <DetailHeader
        kind={t("favorites.kind")}
        title={t("nav.favorites")}
        art={<CoverMosaic tracks={items} empty={<HeartIcon className="fill-current" />} />}
        backdrop={mosaicBackdrop(items)}
        facts={
          data
            ? [
                t("count.tracks", { count: data.total }),
                totalDuration > 0 && format.totalDuration(totalDuration),
              ]
            : undefined
        }
        actions={items.length > 0 ? <PlayAllButton tracks={items} /> : undefined}
      />

      <Query
        result={favorites}
        empty={{
          icon: <HeartIcon size={24} />,
          title: t("favorites.emptyTitle"),
          action: (
            <Button variant="primary" asChild>
              <Link href="/tracks">{t("favorites.browseTracks")}</Link>
            </Button>
          ),
        }}
      >
        {(result) => (
          <>
            <TrackList tracks={result.items} />
            <Pagination result={result} onChange={setPage} />
          </>
        )}
      </Query>
    </>
  );
}

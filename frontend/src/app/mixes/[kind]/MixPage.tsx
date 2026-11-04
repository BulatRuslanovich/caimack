// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useQuery } from "@tanstack/react-query";
import { notFound, useParams } from "next/navigation";
import { isMixSlug, MIXES } from "@/lib/mixes";
import { queries } from "@/lib/queries";
import { useFormat } from "@/lib/useFormat";
import type { HomeMixSlug } from "@/lib/types";
import { CoverMosaic, mosaicBackdrop } from "@/components/collection/CoverMosaic";
import { DetailHeader } from "@/components/DetailHeader";
import { PlayAllButton } from "@/components/PlayAllButton";
import { Query } from "@/components/Query";
import { ShuffleButton } from "@/components/ShuffleButton";
import { TrackList } from "@/components/TrackList";
import { useT } from "@/contexts/I18nContext";
import { Section } from "@/components/PageHeader";

export function MixPage() {
  const kind = useParams<{ kind: string }>().kind;

  if (!isMixSlug(kind)) notFound();

  return <Mix kind={kind} />;
}

function Mix({ kind }: { kind: HomeMixSlug }) {
  const t = useT();
  const format = useFormat();

  const mix = useQuery(queries.homeMix(kind));

  const tracks = mix.data?.tracks ?? [];

  const title = t(MIXES[kind].title);
  const duration = tracks.reduce((total, track) => total + track.durationSeconds, 0);

  return (
    <Query result={mix}>
      {(data) => (
        <>
          <DetailHeader
            kind={t("mixes.kind")}
            title={title}
            art={<CoverMosaic tracks={data.tracks} />}
            backdrop={mosaicBackdrop(data.tracks)}
            facts={
              data.tracks.length > 0
                ? [
                    t("count.tracks", { count: data.tracks.length }),
                    duration > 0 && format.totalDuration(duration),
                  ]
                : undefined
            }
            actions={
              data.tracks.length > 0 ? (
                <>
                  <PlayAllButton tracks={data.tracks} name={title} />
                  <ShuffleButton tracks={data.tracks} />
                </>
              ) : undefined
            }
          />

          <Section title={t("albums.tracks")}>
            <TrackList tracks={data.tracks} emptyMessage={t("mixes.empty")} />
          </Section>
        </>
      )}
    </Query>
  );
}

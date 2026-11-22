// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { formatArtists, genreName } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { PauseIcon, PlayIcon } from "lucide-react";
import type { Route } from "next";
import { PrefetchLink as Link } from "@/components/PrefetchLink";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { artistImageUrl, coverUrl, trackCoverUrl } from "@/lib/media";
import { usePlayback } from "@/lib/playback/usePlayback";
import { queries } from "@/lib/queries";
import type { SearchTopResult, Track } from "@/lib/types";
import { useTone } from "@/lib/useCoverTone";
import { useT } from "@/contexts/I18nContext";
import { AlbumMosaic } from "@/components/collection/CoverMosaic";
import { AlbumCover, ArtistCover, TrackCover } from "@/components/Cover";
import { PlayAllButton } from "@/components/PlayAllButton";
import { Button } from "@/components/ui/button";
import { Caption } from "@/components/ui/caption";
import { Section } from "@/components/PageHeader";

const artworkSizes = "(min-width: 64rem) 128px, 64px";

export function TopResult({ top }: { top: SearchTopResult }) {
  const t = useT();

  const albumId = top.kind === "Album" ? top.album?.id : undefined;
  const artistId = top.kind === "Artist" ? top.artist?.id : undefined;

  const album = useQuery({ ...queries.album(albumId ?? ""), enabled: albumId !== undefined });
  const artist = useQuery({ ...queries.artist(artistId ?? ""), enabled: artistId !== undefined });

  return (
    <Section title={t("search.topResult")} className="min-w-0 gap-2.5 lg:max-w-xl">
      {top.kind === "Track" && top.track ? (
        <Card
          kind={t("nav.tracks")}
          title={top.track.title}
          subtitle={formatArtists(top.track)}
          art={<TrackCover track={top.track} sizes={artworkSizes} />}
          toneSrc={trackCoverUrl(top.track, "thumb")}
          action={<TrackPlayButton track={top.track} />}
        />
      ) : top.kind === "Album" && top.album ? (
        <Card
          href={`/albums/${top.album.id}`}
          kind={t("albums.kind")}
          title={top.album.title}
          subtitle={top.album.artistName}
          art={<AlbumCover album={top.album} sizes={artworkSizes} />}
          toneSrc={coverUrl({ albumId, hasCover: top.album.hasCover, variant: "thumb" })}
          action={
            <PlayAllButton
              tracks={album.data?.tracks ?? []}
              name={top.album.title}
              compact
              className="shrink-0"
            />
          }
        />
      ) : top.kind === "Artist" && top.artist ? (
        <Card
          href={`/artists/${top.artist.id}`}
          kind={t("artists.kind")}
          title={top.artist.name}
          subtitle={t("count.tracks", { count: top.artist.trackCount })}
          round
          art={<ArtistCover artist={top.artist} sizes={artworkSizes} />}
          toneSrc={artistImageUrl({ artistId, hasImage: top.artist.hasImage, variant: "thumb" })}
          action={
            <PlayAllButton
              tracks={artist.data?.tracks.items ?? []}
              name={top.artist.name}
              compact
              className="shrink-0"
            />
          }
        />
      ) : top.genre ? (
        <Card
          href={`/search?tab=genres&id=${top.genre.id}`}
          kind={t("field.genre")}
          title={genreName(top.genre.name)}
          subtitle={t("count.tracks", { count: top.genre.trackCount })}
          art={<AlbumMosaic albumIds={top.genre.coverAlbumIds} name={top.genre.name} />}
          toneSrc={coverUrl({ albumId: top.genre.coverAlbumIds[0], variant: "thumb" })}
        />
      ) : null}
    </Section>
  );
}

function TrackPlayButton({ track }: { track: Track }) {
  const t = useT();
  const { playTrack, soundingNow } = usePlayback();
  const playing = soundingNow(track.id);

  return (
    <Button
      variant="play"
      size="play"
      className="shrink-0 max-md:size-11"
      onClick={() => playTrack(track)}
      aria-label={playing ? t("action.pause") : t("action.playNamed", { name: track.title })}
    >
      {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
    </Button>
  );
}

function Card<T extends string>({
  href,
  kind,
  title,
  subtitle,
  art,
  toneSrc,
  round = false,
  action,
}: {
  href?: Route<T>;
  kind: string;
  title: string;
  subtitle: ReactNode;
  art: ReactNode;
  toneSrc: string | null;
  round?: boolean;
  action?: ReactNode;
}) {
  const tone = useTone<HTMLDivElement>(toneSrc);

  return (
    <div
      {...tone}
      className="listening-panel search-top-result grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg p-3 lg:flex lg:flex-1 lg:flex-col lg:items-start lg:justify-between lg:gap-5 lg:p-6"
    >
      <span
        className={cn(
          "block size-16 shrink-0 overflow-hidden rounded-xs shadow-art lg:size-32",
          round && "rounded-full",
        )}
      >
        {art}
      </span>

      <div className="flex w-full min-w-0 items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Caption>{kind}</Caption>
          <h3 className="wrap-anywhere text-lg leading-tight font-semibold lg:font-display lg:text-[clamp(1.75rem,2.4vw,2.5rem)]">
            {href ? <Link href={href}>{title}</Link> : title}
          </h3>
          <span className="wrap-anywhere text-sm text-muted-foreground">{subtitle}</span>
        </div>
        {action}
      </div>
    </div>
  );
}

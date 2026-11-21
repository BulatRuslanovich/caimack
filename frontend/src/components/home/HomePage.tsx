// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { PlaySource } from "@/lib/playback/playSource";
import { useShelfImpression } from "@/lib/useShelfImpression";
import { queries } from "@/lib/queries";
import type { HomeBlock, Track } from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/contexts/I18nContext";
import { RankedList } from "@/components/collection/RankedList";
import { AlbumCard, ArtistCard, PlaylistCard } from "@/components/MediaCard";
import { Section } from "@/components/PageHeader";
import { desktopRequest, useDesktopStatus, type DesktopStatus } from "@/desktop/api";
import { Query } from "@/components/Query";
import { Shelf } from "@/components/Shelf";
import { Button } from "@/components/ui/button";
import { AudiobookHome } from "@/components/audiobooks/AudiobookViews";
import { blockHref, blockNote, blockSubjectHref, blockTitle } from "./blockMeta";
import { DailyMix, HERO_PREVIEW_SIZE } from "./DailyMix";
import { capFiveOnMobile, deferredSection, dropOrphanRow, listPanel } from "./layout";
import { MixCover } from "./MixCover";
import { RecapBanner } from "./RecapBanner";
import { QuickTiles } from "./QuickTiles";
import { RadioHero } from "./RadioHero";

export function HomePage() {
  const status = useDesktopStatus();
  return status && !status.online ? <OfflineHome status={status} /> : <OnlineHome />;
}

function OfflineHome({ status }: { status: DesktopStatus }) {
  const t = useT();
  const home = useQuery({
    queryKey: [
      "offlineHome",
      status.server,
      status.user?.id,
      status.localTracks,
      status.sync.lastAt,
    ],
    queryFn: () =>
      desktopRequest<{ blocks: HomeBlock[]; downloads: Track[]; radio: Track[] }>("/offline-home"),
    networkMode: "always",
  });
  return (
    <>
      <Query
        result={home}
        isEmpty={(data) => !data.blocks.length && !data.downloads.length}
        empty={{ title: t("home.emptyDownloads") }}
      >
        {({ blocks, downloads, radio }) =>
          blocks.length ? (
            <Blocks blocks={blocks} offline localRadio={radio} />
          ) : (
            <div className="home-page">
              <div className="home-listening-stage">
                <RadioHero tracks={radio} offline />
                <div className="home-daily-selection">
                  <DailyMix
                    title={t("home.downloaded")}
                    block={{
                      key: "downloads",
                      baseKey: "downloads",
                      zone: "Lead",
                      layout: "Hero",
                      tracks: downloads,
                    }}
                  />
                </div>
              </div>
            </div>
          )
        }
      </Query>
      {!home.data?.blocks.length && <AudiobookHome />}
    </>
  );
}

function OnlineHome() {
  const t = useT();
  const { isAdmin } = useAuth();
  const feed = useQuery(queries.homeFeed());

  return (
    <>
      <Query
        result={feed}
        isEmpty={(data) => data.blocks.length === 0}
        empty={{
          title: t("home.emptyTitle"),
          action: isAdmin && (
            <Button variant="primary" asChild>
              <Link href="/upload">{t("home.uploadMusic")}</Link>
            </Button>
          ),
        }}
      >
        {({ blocks }) => <Blocks blocks={blocks} />}
      </Query>
      {!feed.data?.blocks.length && <AudiobookHome />}
    </>
  );
}

function Blocks({
  blocks,
  offline = false,
  localRadio,
}: {
  blocks: HomeBlock[];
  offline?: boolean;
  localRadio?: Track[];
}) {
  const quick = blocks.filter((block) => block.zone === "Quick");
  const lead = blocks.filter((block) => block.zone === "Lead");
  const radioTracks = [
    ...new Map(
      blocks.flatMap((block) => block.tracks ?? []).map((track) => [track.id, track]),
    ).values(),
  ];
  const shown = new Set(
    blocks
      .filter((block) => block.zone !== "Browse" && block.layout !== "Tile")
      .flatMap((block) =>
        block.layout === "Hero"
          ? (block.tracks ?? []).slice(0, HERO_PREVIEW_SIZE)
          : (block.tracks ?? []),
      )
      .map((track) => track.id),
  );

  const seen = new Set(shown);
  const browse = [];
  let includesPopular = false;
  const audiobookAnchor =
    blocks.find((block) => block.zone === "Browse" && block.baseKey === "newArrivals") ??
    blocks.find((block) => block.zone === "Browse" && block.baseKey === "newAlbums");

  for (const block of blocks) {
    if (block.zone !== "Browse") continue;

    if (!offline && block.baseKey === "topTracks") {
      browse.push(<PopularMusic key="popular-music" />);
      includesPopular = true;
      continue;
    }

    const before = new Set(seen);
    let visible = block;

    const trackShelf =
      block.layout === "Shelf" &&
      !block.artists?.length &&
      !block.albums?.length &&
      !block.playlists?.length;

    if (trackShelf) {
      const fresh = (block.tracks ?? []).filter((track) => !seen.has(track.id));
      if (fresh.length < (offline ? 1 : MIN_SHELF)) continue;

      visible = { ...block, tracks: fresh };
    }

    for (const track of visible.tracks ?? []) seen.add(track.id);
    browse.push(<Block key={block.key} block={visible} shown={before} />);
    if (block === audiobookAnchor) browse.push(<AudiobookHome key="last-audiobook" />);
  }

  return (
    <div className="home-page [&_h2]:line-clamp-2 [&_h2]:whitespace-normal">
      <div className="home-listening-stage">
        <RadioHero tracks={localRadio ?? radioTracks} offline={offline} />
        {lead.length > 0 && (
          <div className="home-daily-selection">
            {lead.map((block) => (
              <Block key={block.key} block={block} shown={shown} />
            ))}
          </div>
        )}
        {quick.length > 0 && <QuickTiles blocks={quick} />}
      </div>

      {!offline && <RecapBanner />}

      {!audiobookAnchor && <AudiobookHome />}
      {browse}
      {!offline && !includesPopular && <PopularMusic />}
    </div>
  );
}

function Block({ block, shown }: { block: HomeBlock; shown: Set<string> }) {
  const source = `home:${block.baseKey}`;
  const ref = useShelfImpression<HTMLDivElement>(source);

  return (
    <PlaySource value={source}>
      <div ref={ref}>
        <BlockBody block={block} shown={shown} />
      </div>
    </PlaySource>
  );
}

function BlockBody({ block, shown }: { block: HomeBlock; shown: Set<string> }) {
  const t = useT();

  const title = blockTitle(block, t);
  const note = blockNote(block, t);
  const href = blockHref(block);
  const titleHref = blockSubjectHref(block);

  const section = cn(block.zone === "Browse" && deferredSection);
  const panel = cn(section, listPanel);

  switch (block.layout) {
    case "Hero":
      return <DailyMix block={block} title={title} href={href} />;

    case "Grid": {
      const tracks = block.tracks ?? [];
      const fresh = onePerAlbum(tracks.filter((track) => !shown.has(track.id)));

      return (
        <Section title={title} titleHref={titleHref} note={note} href={href} className={panel}>
          <RankedList
            ranked={false}
            density="compact"
            tracks={fresh.length >= MIN_DISTINCT ? fresh : onePerAlbum(tracks)}
            className={cn(capFiveOnMobile, dropOrphanRow)}
          />
        </Section>
      );
    }

    case "Chart":
      return (
        <Section title={title} titleHref={titleHref} note={note} href={href} className={panel}>
          <RankedList tracks={block.tracks ?? []} className={capFiveOnMobile} />
        </Section>
      );

    default:
      if (!block.artists?.length && !block.albums?.length && !block.playlists?.length) {
        return (
          <Section title={title} titleHref={titleHref} note={note} href={href} className={panel}>
            <div className="grid gap-x-8 lg:grid-cols-[12rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)]">
              <div className="max-lg:hidden">
                <MixCover tracks={block.tracks ?? []} title={title} />
              </div>
              <RankedList ranked={false} tracks={block.tracks ?? []} className={capFiveOnMobile} />
            </div>
          </Section>
        );
      }

      const wholeCards = block.baseKey === "newAlbums";
      return (
        <Shelf
          title={title}
          titleHref={titleHref}
          note={note}
          href={href}
          className={wholeCards ? undefined : section}
          wholeCards={wholeCards}
        >
          <ShelfItems block={block} />
        </Shelf>
      );
  }
}

function ShelfItems({ block }: { block: HomeBlock }) {
  if (block.artists?.length) {
    return block.artists.map((artist) => <ArtistCard key={artist.id} artist={artist} bare />);
  }

  if (block.albums?.length) {
    return block.albums.map((album) => <AlbumCard key={album.id} album={album} />);
  }

  if (block.playlists?.length) {
    return block.playlists.map((playlist) => (
      <PlaylistCard key={playlist.id} playlist={playlist} />
    ));
  }

  return null;
}

const MIN_DISTINCT = 3;

const MIN_SHELF = 4;

function onePerAlbum(tracks: Track[]): Track[] {
  const seen = new Set<string>();

  const distinct = tracks.filter((track) => {
    if (!track.albumId) return true;
    if (seen.has(track.albumId)) return false;

    seen.add(track.albumId);
    return true;
  });

  return distinct.length >= MIN_DISTINCT ? distinct : tracks;
}

function PopularMusic() {
  const t = useT();
  const result = useQuery(queries.searchPopular());

  return (
    <Query result={result}>
      {({ tracks, albums, artists }) => (
        <>
          {tracks.length > 0 && (
            <Section title={t("search.mostPlayedTracks")}>
              <RankedList tracks={tracks} ranked={false} density="compact" />
            </Section>
          )}
          {albums.length > 0 && (
            <Shelf title={t("search.mostPlayedAlbums")} className="gap-2.5">
              {albums.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </Shelf>
          )}
          {artists.length > 0 && (
            <Shelf title={t("search.mostPlayedArtists")} className="gap-2.5">
              {artists.map((artist) => (
                <ArtistCard key={artist.id} artist={artist} bare />
              ))}
            </Shelf>
          )}
        </>
      )}
    </Query>
  );
}

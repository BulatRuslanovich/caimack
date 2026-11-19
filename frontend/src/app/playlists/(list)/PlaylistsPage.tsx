// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { queries } from "@/lib/queries";
import { useInvalidate } from "@/lib/useInvalidate";
import { PlaylistCard } from "@/components/MediaCard";
import { CardGrid, CardGridSkeleton } from "@/components/PageHeader";
import { CatalogToolbar } from "@/app/search/CatalogToolbar";
import { Query } from "@/components/Query";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupButton } from "@/components/ui/toggle-group";
import { ListMusicIcon, PlusIcon } from "lucide-react";
import { useT } from "@/contexts/I18nContext";

const PlaylistDialog = dynamic(() =>
  import("@/components/PlaylistDialog").then((m) => m.PlaylistDialog),
);

type Tab = "mine" | "public";

export function PlaylistsPage({ query }: { query: string }) {
  const t = useT();
  const invalidate = useInvalidate();

  const [tab, setTab] = useState<Tab>("mine");
  const [creating, setCreating] = useState(false);

  const mine = useQuery({ ...queries.playlists(), enabled: tab === "mine" });
  const shared = useQuery({ ...queries.publicPlaylists(), enabled: tab === "public" });
  const playlists = tab === "public" ? shared : mine;
  const term = query.toLocaleLowerCase();
  const matching = term
    ? playlists.data?.filter((playlist) => playlist.name.toLocaleLowerCase().includes(term))
    : playlists.data;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <CatalogToolbar
        summary={matching && t("count.playlists", { count: matching.length })}
        actions={
          <Button
            variant="primary"
            className="px-3 pointer-coarse:h-11"
            onClick={() => setCreating(true)}
          >
            <PlusIcon size={16} /> {t("playlists.new")}
          </Button>
        }
      >
        <ToggleGroup aria-label={t("playlists.tabs")} className="min-w-0 gap-x-4 shadow-none">
          {(["mine", "public"] as const).map((value) => (
            <ToggleGroupButton
              key={value}
              active={tab === value}
              className="h-10 py-0 pointer-coarse:h-11"
              onClick={() => setTab(value)}
            >
              {value === "mine" ? t("playlists.mine") : t("playlists.public")}
            </ToggleGroupButton>
          ))}
        </ToggleGroup>
      </CatalogToolbar>

      <Query
        result={playlists}
        isEmpty={() => !matching?.length}
        skeleton={<CardGridSkeleton />}
        empty={
          query
            ? { icon: <ListMusicIcon size={24} />, title: t("search.nothingFound") }
            : tab === "public"
              ? {
                  icon: <ListMusicIcon size={24} />,
                  title: t("playlists.publicEmptyTitle"),
                }
              : {
                  icon: <ListMusicIcon size={24} />,
                  title: t("playlists.emptyTitle"),
                }
        }
      >
        {() => (
          <CardGrid>
            {matching?.map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} showOwner={tab === "public"} />
            ))}
          </CardGrid>
        )}
      </Query>

      {creating && (
        <PlaylistDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            invalidate("playlists");
            setTab("mine");
          }}
        />
      )}
    </div>
  );
}

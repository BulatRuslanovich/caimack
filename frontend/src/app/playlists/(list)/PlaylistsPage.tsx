// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { queries } from "@/lib/queries";
import { useInvalidate } from "@/lib/useInvalidate";
import { PlaylistCard } from "@/components/MediaCard";
import { CardGrid, CardGridSkeleton, PageHeader } from "@/components/PageHeader";
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

  const newButton = (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <PlusIcon size={16} /> {t("playlists.new")}
    </Button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6 max-md:gap-5">
      <PageHeader
        subtitle={matching && t("count.playlists", { count: matching.length })}
        actions={newButton}
      />

      <ToggleGroup aria-label={t("playlists.tabs")}>
        {(["mine", "public"] as const).map((value) => (
          <ToggleGroupButton key={value} active={tab === value} onClick={() => setTab(value)}>
            {value === "mine" ? t("playlists.mine") : t("playlists.public")}
          </ToggleGroupButton>
        ))}
      </ToggleGroup>

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
                  action: newButton,
                }
        }
      >
        {() => (
          <CardGrid>
            {matching?.map((playlist) => (
              <PlaylistCard key={playlist.id} playlist={playlist} showOwner={tab === "public"} />
            ))}
            {tab === "mine" && !query && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="group flex min-w-0 flex-col gap-0.5 text-left"
              >
                <span className="mb-2.5 grid aspect-square w-full place-items-center rounded-xs border-2 border-dashed border-border-strong text-faint transition-colors duration-150 ease-brand group-hover:border-foreground group-hover:text-foreground">
                  <PlusIcon size={34} />
                </span>
                <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground">
                  {t("playlists.new")}
                </span>
              </button>
            )}
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

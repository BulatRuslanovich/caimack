// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { TrackFilter, TrackSort } from "@/lib/types";
import { CAMELOT_KEYS } from "@/lib/musicalKey";
import type { TranslationKey } from "@/lib/i18n";
import { TRACK_PAGE_SIZE } from "@/lib/pageSizes";
import { queries } from "@/lib/queries";
import { useFormat } from "@/lib/useFormat";
import { usePage } from "@/lib/usePage";
import { useInvalidate } from "@/lib/useInvalidate";
import { useRowSelection } from "@/lib/useRowSelection";
import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/contexts/I18nContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useToast } from "@/lib/useToast";
import { PageHeader, Section } from "@/components/PageHeader";
import { Pagination, PageToolbar, SortSelect } from "@/components/PageToolbar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlayAllButton } from "@/components/PlayAllButton";
import { Query } from "@/components/Query";
import { TrackList } from "@/components/TrackList";
import { Button } from "@/components/ui/button";
import { CheckIcon, ShuffleIcon } from "lucide-react";
import { useConfirm } from "@/components/ui/alert-dialog";

const sortKeys: Record<TrackSort, TranslationKey> = {
  Title: "sort.title",
  Recent: "sort.dateAdded",
  Artist: "sort.artist",
  Album: "sort.album",
  Bpm: "sort.bpm",
  Key: "sort.key",
  Loudness: "sort.loudness",
};

const ANY = "any";

const TEMPOS: Record<string, { phrase: TranslationKey; filter: TrackFilter }> = {
  slow: { phrase: "filter.tempo.slow", filter: { bpmMax: 90 } },
  medium: { phrase: "filter.tempo.medium", filter: { bpmMin: 90, bpmMax: 120 } },
  fast: { phrase: "filter.tempo.fast", filter: { bpmMin: 120, bpmMax: 150 } },
  veryFast: { phrase: "filter.tempo.veryFast", filter: { bpmMin: 150 } },
};

export function TracksPage() {
  const t = useT();
  const format = useFormat();
  const player = usePlayerActions();
  const { isAdmin } = useAuth();
  const [confirm, confirmDialog] = useConfirm();

  const [sort, setSort] = useState<TrackSort>("Title");
  const [search, setSearch] = useState("");
  const [tempo, setTempo] = useState(ANY);
  const [key, setKey] = useState(ANY);
  const [page, setPage] = usePage([sort, search, tempo, key]);
  const filter: TrackFilter = {
    ...TEMPOS[tempo]?.filter,
    key: key === ANY ? undefined : key,
  };

  const tracks = useQuery(
    queries.tracks({
      page,
      pageSize: TRACK_PAGE_SIZE,
      sort,
      q: search || undefined,
      ...filter,
    }),
  );
  const filtered = Boolean(search) || tempo !== ANY || key !== ANY;
  const stats = useQuery(queries.libraryOverview()).data?.stats;

  const items = useMemo(() => tracks.data?.items ?? [], [tracks.data]);
  const ids = useMemo(() => items.map((track) => track.id), [items]);

  const selection = useRowSelection(ids, `${page}:${sort}:${search}:${tempo}:${key}`);

  const [selecting, setSelecting] = useState(false);
  const { clear } = selection;

  const stopSelecting = useCallback(() => {
    setSelecting(false);
    clear();
  }, [clear]);

  useEffect(() => {
    if (!selecting) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;

      stopSelecting();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selecting, stopSelecting]);

  const shuffle = useMutation({
    mutationFn: () => api.shuffleTracks({ q: search || undefined, ...filter }),
    onSuccess: (shuffled) => {
      if (shuffled.length === 0) return;

      player.setShuffle(true);
      player.playQueue(shuffled, 0);
    },
  });

  return (
    <>
      <PageHeader
        title={t("nav.tracks")}
        subtitle={
          tracks.data && (
            <>
              <span className="whitespace-nowrap">
                {t("count.tracksInLibrary", { count: tracks.data.total })}
              </span>
              {!filtered && stats && stats.totalDurationSeconds > 0 && (
                <span className="whitespace-nowrap">
                  {" · "}
                  {format.totalDuration(stats.totalDurationSeconds)}
                </span>
              )}
            </>
          )
        }
        actions={
          items.length > 0 && (
            <>
              <PlayAllButton tracks={items} />
              <Button onClick={() => shuffle.mutate()} disabled={shuffle.isPending}>
                <ShuffleIcon size={16} />
                {shuffle.isPending ? t("action.shuffling") : t("action.shuffle")}
              </Button>
            </>
          )
        }
      />

      <PageToolbar search={search} onSearch={setSearch} placeholder={t("filter.tracks")}>
        <SortSelect value={sort} onChange={setSort} options={sortKeys} />
        <Select value={tempo} onValueChange={setTempo}>
          <SelectTrigger aria-label={t("sort.bpm")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("filter.anyTempo")}</SelectItem>
            {Object.entries(TEMPOS).map(([value, { phrase }]) => (
              <SelectItem key={value} value={value}>
                {t(phrase)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={key} onValueChange={setKey}>
          <SelectTrigger aria-label={t("sort.key")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("filter.anyKey")}</SelectItem>
            {CAMELOT_KEYS.map(({ camelot, name }) => (
              <SelectItem key={camelot} value={camelot}>
                {camelot} · {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdmin && (
          <BulkActions
            selection={selection}
            selecting={selecting}
            onStart={() => setSelecting(true)}
            onStop={stopSelecting}
            confirm={confirm}
          />
        )}
      </PageToolbar>

      <Query result={tracks}>
        {(data) => (
          <Section>
            <TrackList
              tracks={data.items}
              showTempoKey
              emptyMessage={filtered ? t("filter.nothingMatched") : undefined}
              selection={
                isAdmin && selecting
                  ? {
                      selected: selection.selected,
                      onToggle: selection.toggle,
                      onToggleAll: selection.toggleAll,
                    }
                  : undefined
              }
            />

            <Pagination result={data} onChange={setPage} />
          </Section>
        )}
      </Query>

      {confirmDialog}
    </>
  );
}

function BulkActions({
  selection,
  selecting,
  onStart,
  onStop,
  confirm,
}: {
  selection: ReturnType<typeof useRowSelection>;
  selecting: boolean;
  onStart: () => void;
  onStop: () => void;
  confirm: ReturnType<typeof useConfirm>[0];
}) {
  const t = useT();
  const { notify } = useToast();
  const invalidate = useInvalidate();

  const { selected } = selection;

  const deleteSelected = useMutation({
    mutationFn: () => api.deleteTracks([...selected]),
    onSuccess: (result) => {
      onStop();
      notify(t("tracks.deletedCount", { count: result.deleted }), "success");
      invalidate("library", "playlists", "favorites", "history");
    },
  });

  if (!selecting) {
    return (
      <div className="flex min-h-9 items-center">
        <Button variant="text" size="auto" onClick={onStart}>
          <CheckIcon size={16} />
          {t("tracks.selectMode")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-9 items-center gap-2">
      <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
        {t("tracks.selectedCount", { count: selected.size })}
      </span>

      {selected.size > 0 && (
        <Button
          variant="destructive"
          disabled={deleteSelected.isPending}
          onClick={() =>
            confirm({
              title: t("tracks.confirmBulkDelete", { count: selected.size }),
              description: t("tracks.bulkDeleteHint"),
              confirmLabel: t("action.delete"),
              destructive: true,
              action: () => deleteSelected.mutate(),
            })
          }
        >
          {t("action.delete")}
        </Button>
      )}

      <Button variant="text" size="auto" disabled={deleteSelected.isPending} onClick={onStop}>
        {t("tracks.exitSelectMode")}
      </Button>
    </div>
  );
}

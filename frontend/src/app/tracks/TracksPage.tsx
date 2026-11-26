// SPDX-License-Identifier: AGPL-3.0-only

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
import { useTrackSort } from "@/lib/useTrackSort";
import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/contexts/I18nContext";
import { useToast } from "@/lib/useToast";
import { Section } from "@/components/PageHeader";
import { Pagination, ToolbarFilters } from "@/components/PageToolbar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlayAllButton } from "@/components/PlayAllButton";
import { ShuffleButton } from "@/components/ShuffleButton";
import { Query } from "@/components/Query";
import { TrackList, type TrackSortColumn } from "@/components/TrackList";
import { TrackSortMenu } from "@/components/TrackSortMenu";
import { TrackDisplayMenu } from "@/components/TrackDisplayMenu";
import { useTrackDisplay } from "@/lib/trackDisplay";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "lucide-react";
import { useConfirm } from "@/components/ui/alert-dialog";

const sortKeys: Record<TrackSort, TranslationKey> = {
  Title: "sort.title",
  Recent: "sort.dateAdded",
  Artist: "sort.artist",
  Album: "sort.album",
  Duration: "sort.duration",
  Year: "sort.year",
  Bpm: "sort.bpm",
  Key: "sort.key",
  Loudness: "sort.loudness",
};

const COLUMN_SORTS: Record<TrackSortColumn, TrackSort> = {
  title: "Title",
  album: "Album",
  added: "Recent",
  duration: "Duration",
};

const ANY = "any";

const TEMPOS: Record<string, { phrase: TranslationKey; filter: TrackFilter }> = {
  slow: { phrase: "filter.tempo.slow", filter: { bpmMax: 90 } },
  medium: { phrase: "filter.tempo.medium", filter: { bpmMin: 90, bpmMax: 120 } },
  fast: { phrase: "filter.tempo.fast", filter: { bpmMin: 120, bpmMax: 150 } },
  veryFast: { phrase: "filter.tempo.veryFast", filter: { bpmMin: 150 } },
};

export function TracksPage({ query }: { query: string }) {
  const t = useT();
  const display = useTrackDisplay();
  const format = useFormat();
  const { isAdmin } = useAuth();
  const [confirm, confirmDialog] = useConfirm();

  const sorting = useTrackSort<TrackSort>("Title", { Recent: "desc", Loudness: "desc" });
  const { value: sort, direction } = sorting;
  const sortColumn = (Object.keys(COLUMN_SORTS) as TrackSortColumn[]).find(
    (column) => COLUMN_SORTS[column] === sort,
  );
  const [tempo, setTempo] = useState(ANY);
  const [key, setKey] = useState(ANY);
  const [page, setPage] = usePage([sort, direction, query, tempo, key]);
  const filter: TrackFilter = {
    ...TEMPOS[tempo]?.filter,
    key: key === ANY ? undefined : key,
  };

  const tracks = useQuery(
    queries.tracks({
      page,
      pageSize: TRACK_PAGE_SIZE,
      sort,
      direction,
      q: query || undefined,
      ...filter,
    }),
  );
  const filtered = Boolean(query) || tempo !== ANY || key !== ANY;
  const stats = useQuery({ ...queries.libraryOverview(), enabled: !filtered }).data?.stats;

  const items = useMemo(() => tracks.data?.items ?? [], [tracks.data]);
  const ids = useMemo(() => items.map((track) => track.id), [items]);

  const selection = useRowSelection(
    ids,
    JSON.stringify([page, sort, direction, query, tempo, key]),
  );

  const [selecting, setSelecting] = useState(false);
  const { clear } = selection;

  const stopSelecting = useCallback(() => {
    setSelecting(false);
    clear();
  }, [clear]);

  useEffect(() => {
    if (!selecting) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        )
      )
        return;

      stopSelecting();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selecting, stopSelecting]);

  return (
    <div className="track-catalog flex min-w-0 flex-col gap-2.5">
      {tracks.data && (
        <p className="text-sm text-muted-foreground">
          {t("count.tracksInLibrary", { count: tracks.data.total })}
          {!filtered && stats && stats.totalDurationSeconds > 0 && (
            <span className="whitespace-nowrap">
              {" · "}
              {format.totalDuration(stats.totalDurationSeconds)}
            </span>
          )}
        </p>
      )}

      <div className="library-toolbar flex flex-wrap items-center gap-2">
        <TrackSortMenu {...sorting} options={sortKeys} />
        <ToolbarFilters
          compact
          mobileFilters={{ active: tempo !== ANY || key !== ANY || selecting }}
        >
          <Select value={tempo} onValueChange={setTempo}>
            <SelectTrigger aria-label={t("sort.bpm")} data-active={tempo !== ANY}>
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
            <SelectTrigger aria-label={t("sort.key")} data-active={key !== ANY}>
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
          <TrackDisplayMenu />
          {isAdmin && (
            <BulkActions
              selection={selection}
              selecting={selecting}
              onStart={() => setSelecting(true)}
              onStop={stopSelecting}
              confirm={confirm}
            />
          )}
        </ToolbarFilters>
        {items.length > 0 && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <PlayAllButton tracks={items} className="size-10 pointer-coarse:size-11" />
            <ShuffleButton tracks={items} compact />
          </div>
        )}
      </div>

      <Query result={tracks}>
        {(data) => (
          <Section className="gap-2">
            <TrackList
              tracks={data.items}
              showPlayButtons
              addedAt="createdAt"
              sort={{
                active: sortColumn,
                direction,
                onChange: (column) => sorting.onChange(COLUMN_SORTS[column]),
              }}
              showTempoKey={display.showTempoKey}
              showAudioSpec={display.showAudioSpec}
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
    </div>
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
      <Button onClick={onStart}>
        <CheckIcon size={16} />
        {t("tracks.selectMode")}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
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

      <Button data-active disabled={deleteSelected.isPending} onClick={onStop}>
        {t("tracks.exitSelectMode")}
      </Button>
    </div>
  );
}

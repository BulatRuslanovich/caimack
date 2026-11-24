// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useT } from "@/contexts/I18nContext";
import { api } from "@/lib/api";
import { formatArtists } from "@/lib/format";
import { queries, SEARCH_MIN_LENGTH } from "@/lib/queries";
import type { PlaylistDetail, Track } from "@/lib/types";
import { useInvalidate } from "@/lib/useInvalidate";
import { useRecommendations } from "@/lib/useRecommendations";
import { useToast } from "@/lib/useToast";
import { TrackCover } from "./Cover";
import { Loading } from "./Loading";
import { Pagination } from "./PageToolbar";
import { PlaylistActionDialog, type ReturnFocus } from "./PlaylistActionDialog";
import { LoadError, Query } from "./Query";
import { SearchField } from "./SearchField";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";

export function PlaylistAddTracksDialog({
  playlist,
  onClose,
  returnFocus,
}: {
  playlist: PlaylistDetail;
  onClose: () => void;
  returnFocus: ReturnFocus;
}) {
  const t = useT();
  const invalidate = useInvalidate();
  const { notify } = useToast();
  const recommendations = useRecommendations();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const query = draft.trim();
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const existing = new Set(playlist.tracks.map((track) => track.id));
  const newIds = [...selected].filter((id) => !existing.has(id));

  const search = useQuery({
    ...queries.searchTab("tracks", searchTerm, { page, pageSize: 25 }),
    enabled: query === searchTerm && searchTerm.length >= SEARCH_MIN_LENGTH,
    placeholderData: undefined,
  });
  const suggestions = useQuery({
    ...queries.playlistSuggestions(playlist.id),
    enabled: recommendations && playlist.tracks.length > 0,
  });
  const save = useMutation({
    mutationFn: (ids: string[]) => api.changePlaylistMembership(playlist.id, ids, true),
    onSuccess: ({ changed }) => {
      invalidate("playlists");
      notify(t("playlists.tracksAdded", { count: changed }), "success");
      onClose();
    },
  });

  const trackRows = (tracks: Track[]) =>
    tracks.map((track) => {
      const added = existing.has(track.id);
      return (
        <label
          key={track.id}
          className="flex min-h-12 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-hover"
        >
          <Checkbox
            checked={added || selected.has(track.id)}
            disabled={added || save.isPending}
            aria-label={
              added
                ? t("playlists.alreadyAddedTrack", { title: track.title })
                : t("tracks.selectNamed", { title: track.title })
            }
            onCheckedChange={(checked) =>
              setSelected((previous) => {
                const next = new Set(previous);
                if (checked) next.add(track.id);
                else next.delete(track.id);
                return next;
              })
            }
          />
          <TrackCover track={track} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{track.title}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {formatArtists(track)}
            </span>
          </span>
          {added && (
            <span className="text-xs text-muted-foreground">{t("playlists.alreadyAdded")}</span>
          )}
        </label>
      );
    });

  return (
    <PlaylistActionDialog
      title={t("playlists.addTracks")}
      onClose={onClose}
      returnFocus={returnFocus}
      busy={save.isPending}
      footer={
        <>
          <Button
            variant="primary"
            disabled={!newIds.length || save.isPending}
            onClick={() => save.mutate(newIds)}
          >
            {save.isPending
              ? t("action.saving")
              : t("playlists.addSelected", { count: newIds.length })}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t("action.cancel")}
          </Button>
        </>
      }
    >
      <SearchField
        className="max-w-none"
        inputRef={input}
        placeholder={t("playlists.searchTracks")}
        value={searchTerm}
        onDraftChange={setDraft}
        onChange={(value) => {
          setSearchTerm(value);
          setPage(1);
        }}
      />
      {save.isError && (
        <div className="mt-3">
          <LoadError message={t("playlists.changeFailed")} />
        </div>
      )}
      {query.length >= SEARCH_MIN_LENGTH && (
        <div className="mt-3">
          {query !== searchTerm ? (
            <Loading size="s" />
          ) : (
            <Query result={search} skeleton={<Loading size="s" />}>
              {(data) =>
                data.items.length ? (
                  <>
                    {trackRows(data.items)}
                    <Pagination
                      result={data}
                      onChange={setPage}
                      scrollOnChange={() => {
                        input.current?.scrollIntoView({ block: "nearest" });
                      }}
                    />
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("search.nothingFound")}</p>
                )
              }
            </Query>
          )}
        </div>
      )}
      {recommendations && (
        <section className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">{t("playlists.suggestions")}</h3>
          {!playlist.tracks.length ? (
            <p className="text-sm text-muted-foreground">{t("playlists.noSuggestions")}</p>
          ) : (
            <Query result={suggestions} skeleton={<Loading size="s" />}>
              {(batch) =>
                batch.tracks.length ? (
                  trackRows(batch.tracks.map(({ track }) => track))
                ) : (
                  <p className="text-sm text-muted-foreground">{t("playlists.noSuggestions")}</p>
                )
              }
            </Query>
          )}
        </section>
      )}
    </PlaylistActionDialog>
  );
}

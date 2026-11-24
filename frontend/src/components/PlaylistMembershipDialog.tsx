// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useT } from "@/contexts/I18nContext";
import { api } from "@/lib/api";
import { recordEvent } from "@/lib/events";
import { savePlaylistMemberships } from "@/lib/playlistTracks";
import { queries } from "@/lib/queries";
import type { Track } from "@/lib/types";
import { useInvalidate } from "@/lib/useInvalidate";
import { PlaylistActionDialog, type ReturnFocus } from "./PlaylistActionDialog";
import { PlaylistDialog } from "./PlaylistDialog";
import { Query } from "./Query";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";

interface MembershipDialogProps {
  track: Track;
  onClose: () => void;
  returnFocus: ReturnFocus;
}

export function PlaylistMembershipDialog({ track, onClose, returnFocus }: MembershipDialogProps) {
  const t = useT();
  const invalidate = useInvalidate();
  const client = useQueryClient();
  const query = queries.playlistMemberships(track.id);
  const memberships = useQuery(query);
  const rows = memberships.data;
  const [desired, setDesired] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const createButton = useRef<HTMLButtonElement>(null);
  const rowId = useId();

  const apply = async () => {
    if (!rows) return;
    setSaving(true);
    const result = await savePlaylistMemberships(rows, desired, async (id, present) => {
      const { changed } = await api.changePlaylistMembership(id, [track.id], present);
      if (changed)
        recordEvent({
          type: present ? "trackAddedToPlaylist" : "trackRemovedFromPlaylist",
          trackId: track.id,
          entityId: id,
        });
    });
    if (result.saved.size) {
      await client.cancelQueries({ queryKey: query.queryKey });
      client.setQueryData(query.queryKey, (current) =>
        current?.map((row) => {
          const present = result.saved.get(row.playlist.id);
          return present === undefined ? row : { ...row, containsTrack: present };
        }),
      );
      setDesired(new Map([...desired].filter(([id]) => result.failed.has(id))));
      setSaved((previous) => new Set([...previous, ...result.saved.keys()]));
      invalidate("playlists");
    }
    setFailed(result.failed);
    setSaving(false);
    if (!result.failed.size) onClose();
  };

  return (
    <>
      <PlaylistActionDialog
        title={t("playlists.memberships")}
        busy={saving}
        onClose={onClose}
        returnFocus={returnFocus}
        footer={
          <>
            <Button variant="primary" onClick={() => void apply()} disabled={saving || !rows}>
              {saving
                ? t("action.saving")
                : failed.size
                  ? t("action.tryAgain")
                  : t("playlists.done")}
            </Button>
            <Button variant="outline" onClick={onClose} disabled={saving}>
              {t("action.cancel")}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">{track.title}</p>
        {!rows && <Query result={memberships}>{() => null}</Query>}
        {rows && (
          <Button
            ref={createButton}
            variant="outline"
            onClick={() => setCreating(true)}
            disabled={saving}
          >
            <PlusIcon size={16} /> {t("playlists.new")}
          </Button>
        )}
        <div className="mt-3 flex flex-col" aria-busy={saving}>
          {rows?.map(({ playlist, containsTrack }) => {
            const id = playlist.id;
            const checked = desired.get(id) ?? containsTrack;
            const isFailed = failed.has(id);
            const isSaved = saved.has(id) && checked === containsTrack;
            const status = isFailed
              ? t("playlists.membershipFailed")
              : isSaved
                ? t("playlists.membershipSaved")
                : null;
            return (
              <label
                key={id}
                className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 hover:bg-hover"
              >
                <Checkbox
                  checked={checked}
                  disabled={saving}
                  aria-describedby={status ? rowId + id : undefined}
                  aria-labelledby={rowId + id + "-label"}
                  onCheckedChange={(checked) => {
                    setDesired((previous) => {
                      const next = new Map(previous);
                      if (checked === containsTrack) next.delete(id);
                      else next.set(id, checked === true);
                      return next;
                    });
                    setFailed((previous) => new Set([...previous].filter((key) => key !== id)));
                  }}
                />
                <span className="min-w-0 break-words">
                  <span id={rowId + id + "-label"}>{playlist.name}</span>
                  {status && (
                    <span
                      id={rowId + id}
                      className={
                        isFailed
                          ? "block text-xs text-destructive"
                          : "block text-xs text-muted-foreground"
                      }
                    >
                      {status}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        {failed.size > 0 && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {t("playlists.membershipPartial")}
          </p>
        )}
      </PlaylistActionDialog>
      {creating && (
        <PlaylistDialog
          onClose={() => setCreating(false)}
          returnFocus={() => createButton.current}
          withTrack={{
            id: track.id,
            onCreated: (playlist) => {
              client.setQueryData(query.queryKey, (current) => [
                ...(current ?? []).filter((row) => row.playlist.id !== playlist.id),
                { playlist, containsTrack: true },
              ]);
              setSaved((current) => new Set([...current, playlist.id]));
              recordEvent({
                type: "trackAddedToPlaylist",
                trackId: track.id,
                entityId: playlist.id,
              });
              invalidate("playlists");
            },
          }}
        />
      )}
    </>
  );
}

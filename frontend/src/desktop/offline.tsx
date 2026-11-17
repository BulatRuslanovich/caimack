// SPDX-License-Identifier: AGPL-3.0-only
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, DownloadIcon, FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { BrandMark, BrandWordmark } from "@/components/Brand";
import { EmptyState } from "@/components/EmptyState";
import { Loading } from "@/components/Loading";
import { TrackCover } from "@/components/Cover";
import { Button } from "@/components/ui/button";
import { MenuItem } from "@/components/track-menu/MenuPrimitives";
import { useI18n } from "@/contexts/I18nContext";
import { usePlayerActions } from "@/contexts/PlayerContext";
import { useToast } from "@/lib/useToast";
import type { Locale } from "@/lib/i18n";
import type { Track } from "@/lib/types";
import {
  desktopRequest,
  isDesktop,
  refreshDesktop,
  useDesktopStatus,
  useDesktopSyncEnabled,
  useDesktopTrack,
  type DesktopStatus,
  type Transfer,
} from "./api";

export const downloadsTitle = (locale: Locale) => (locale === "ru" ? "Загрузки" : "Downloads");

function useCopy() {
  const { locale } = useI18n();
  return (en: string, ru: string) => (locale === "ru" ? ru : en);
}

type Command = { path: string; body?: unknown };

function useDesktopCommand() {
  const { notifyError } = useToast();
  const client = useQueryClient();
  return useMutation({
    meta: { handlesError: true },
    mutationFn: ({ path, body = {} }: Command) => desktopRequest(path, body),
    onSuccess: async () => {
      await refreshDesktop();
    },
    onError: (error) => notifyError(error),
    onSettled: (_value, _error, command) => {
      if (command.path.startsWith("/sync")) void client.invalidateQueries();
    },
  });
}

export function ConnectionForm({ locale, initial }: { locale: Locale; initial?: DesktopStatus }) {
  const ru = locale === "ru";
  const [server, setServer] = useState(initial?.server ?? "");
  const [allowHttp, setAllowHttp] = useState(initial?.allowHttp ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await desktopRequest("/connection", { server: server.trim(), allowHttp });
      location.replace("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  const form = (
    <form onSubmit={connect} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2 text-sm">
        {ru ? "Адрес сервера Caimack" : "Caimack server address"}
        <input
          required
          type="url"
          className="rounded-md border border-border bg-background px-3 py-2"
          placeholder="https://music.example.com"
          value={server}
          onChange={(event) => setServer(event.target.value)}
          disabled={busy}
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={allowHttp}
          onChange={(event) => setAllowHttp(event.target.checked)}
        />
        {ru ? "Разрешить HTTP в локальной сети" : "Allow HTTP on the local network"}
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        variant="primary"
        disabled={
          busy || (!!initial && server === initial.server && allowHttp === initial.allowHttp)
        }
      >
        {ru ? "Подключиться" : "Connect"}
      </Button>
    </form>
  );
  if (initial) return form;
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <div className="w-[min(26rem,100%)] rounded-lg bg-card p-6">
        <div className="mb-6 flex items-center justify-center gap-3">
          <BrandMark className="size-10" />
          <h1>
            <BrandWordmark className="text-xl" />
          </h1>
        </div>
        {form}
      </div>
    </main>
  );
}

function transferLabel(copy: ReturnType<typeof useCopy>, transfer?: Transfer) {
  switch (transfer?.status) {
    case "complete":
      return copy("Remove download", "Удалить загрузку");
    case "failed":
      return copy("Retry download", "Повторить загрузку");
    case "queued":
    case "running":
      return copy("Cancel download", "Отменить загрузку");
    default:
      return copy("Download", "Скачать");
  }
}

export function DesktopTrackDownload({ track }: { track: Track }) {
  const copy = useCopy();
  const status = useDesktopStatus();
  const command = useDesktopCommand();
  if (!status || status.sync.enabled) return null;
  const transfer = status.downloads.find((item) => item.track.id === track.id);
  const add = !transfer || transfer.status === "failed";
  return (
    <MenuItem
      disabled={command.isPending}
      onSelect={(event) => {
        event.preventDefault();
        command.mutate(
          add
            ? { path: "/downloads", body: { tracks: [track] } }
            : { path: "/downloads/" + track.id, body: {} },
        );
      }}
    >
      {transfer?.status === "complete" ? <CheckIcon size={16} /> : <DownloadIcon size={16} />}
      {transferLabel(copy, transfer)}
    </MenuItem>
  );
}

export function DesktopCollectionDownload({
  tracks,
  artist,
}: {
  tracks: Track[];
  artist?: string;
}) {
  const copy = useCopy();
  const status = useDesktopStatus();
  const command = useDesktopCommand();
  if (!isDesktop || !status || status.sync.enabled || !tracks.length) return null;
  const complete = !artist && tracks.every((track) => !!status.localTracks[track.id]);
  const label = complete
    ? copy("Downloaded", "Скачано")
    : copy("Download collection", "Скачать подборку");
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon"
      aria-label={label}
      title={label}
      disabled={complete || command.isPending}
      onClick={() => command.mutate({ path: "/downloads", body: artist ? { artist } : { tracks } })}
    >
      {complete ? <CheckIcon size={16} /> : <DownloadIcon size={16} />}
    </Button>
  );
}

export function DownloadBadge({ id }: { id: string }) {
  const copy = useCopy();
  const local = useDesktopTrack(id);
  const syncEnabled = useDesktopSyncEnabled();
  return local && !syncEnabled ? (
    <span title={copy("Downloaded", "Скачано")}>
      <DownloadIcon size={12} />
    </span>
  ) : null;
}

const size = (bytes: number) => (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);

function DownloadRow({
  transfer,
  play,
  syncEnabled,
}: {
  transfer: Transfer;
  play: () => void;
  syncEnabled: boolean;
}) {
  const copy = useCopy();
  const command = useDesktopCommand();
  const { track, status, bytes, total, error } = transfer;
  const add = status === "failed";
  return (
    <li className="flex items-center gap-3 rounded-md bg-card p-3">
      <TrackCover track={track} size={44} />
      <div className="flex min-w-0 flex-1 flex-col">
        <button
          className="truncate text-left font-medium"
          onClick={play}
          disabled={status !== "complete"}
        >
          {track.title}
        </button>
        <span className="truncate text-sm text-muted-foreground">{track.artistName}</span>
        {status === "running" && (
          <progress max={total ?? undefined} value={total ? bytes : undefined} />
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
      <span className="text-xs text-muted-foreground">
        {size(bytes)} {copy("MiB", "МиБ")}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={command.isPending || (syncEnabled && add)}
        onClick={() =>
          command.mutate(
            add
              ? { path: "/downloads", body: { tracks: [track] } }
              : { path: "/downloads/" + track.id },
          )
        }
      >
        {transferLabel(copy, transfer)}
      </Button>
    </li>
  );
}

export function DownloadsPage() {
  const { locale } = useI18n();
  const copy = useCopy();
  const status = useDesktopStatus();
  const { playTrack } = usePlayerActions();
  const command = useDesktopCommand();
  if (!status) return <Loading />;
  const { downloads, sync } = status;
  const downloaded = downloads
    .filter((item) => item.status === "complete")
    .map((item) => item.track);
  const usage = sync.size + downloads.reduce((total, item) => total + item.bytes, 0);
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl">{downloadsTitle(locale)}</h1>
        <p className="mt-1 text-muted-foreground">
          {size(usage)} {copy("MiB on disk", "МиБ на диске")}
        </p>
        {!status.online && (
          <p role="status" className="text-sm text-muted-foreground">
            {copy("Server unavailable", "Сервер недоступен")}
          </p>
        )}
      </header>
      <section
        className="flex flex-col gap-4 rounded-lg bg-card p-4"
        aria-labelledby="library-sync-heading"
      >
        <h2 id="library-sync-heading" className="text-xl">
          {copy("Library synchronization", "Синхронизация медиатеки")}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={command.isPending || sync.running}
            onClick={() => command.mutate({ path: "/sync/folder" })}
          >
            <FolderOpenIcon size={16} /> {copy("Choose folder", "Выбрать папку")}
          </Button>
          {sync.folder && (
            <span className="min-w-0 break-all text-sm text-muted-foreground">{sync.folder}</span>
          )}
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={sync.enabled}
            disabled={!sync.folder || command.isPending}
            onChange={(event) =>
              command.mutate({ path: "/sync/config", body: { enabled: event.target.checked } })
            }
          />
          {copy(
            "Synchronize this library on the local network",
            "Синхронизировать медиатеку в локальной сети",
          )}
        </label>
        {sync.enabled && (
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={sync.running || command.isPending}
              onClick={() => command.mutate({ path: "/sync/run" })}
            >
              <RefreshCwIcon size={16} /> {copy("Sync now / resume", "Запустить / продолжить")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={sync.paused || command.isPending}
              onClick={() => command.mutate({ path: "/sync/pause" })}
            >
              {copy("Pause", "Пауза")}
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-1 text-sm text-muted-foreground" aria-live="polite">
          {sync.running && (
            <span>
              {sync.completed} / {sync.total} · {size(sync.bytes)} {copy("MiB", "МиБ")}
            </span>
          )}
          {sync.running && (
            <progress
              max={sync.trackBytes || undefined}
              value={sync.trackBytes ? sync.bytes : undefined}
            />
          )}
          {sync.lastAt && (
            <span>
              {copy("Last sync", "Последняя синхронизация")} ·{" "}
              {new Date(sync.lastAt).toLocaleString(locale)}
            </span>
          )}
          {sync.pending > 0 && (
            <span>
              {sync.pending} {copy("pending changes", "изменений в очереди")}
            </span>
          )}
          {sync.error && (
            <span role="alert" className="text-destructive">
              {sync.error}
            </span>
          )}
        </div>
        {!!sync.rejected.length && (
          <details>
            <summary>
              {copy("Rejected changes", "Отклонённые изменения")} ({sync.rejected.length})
            </summary>
            <ul>
              {sync.rejected.map((item) => (
                <li key={item.id}>{item.message}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={status.autoDownloads}
          disabled={sync.enabled || command.isPending}
          onChange={(event) =>
            command.mutate({ path: "/auto-downloads", body: { enabled: event.target.checked } })
          }
        />
        {copy(
          "Automatically download Daily Mix and recent favourites",
          "Скачивать Микс дня и последние избранные треки",
        )}
      </label>
      <section>
        <h2 className="mb-3 text-xl">{copy("Individual downloads", "Отдельные загрузки")}</h2>
        {downloads.length ? (
          <ul className="flex flex-col gap-2">
            {downloads.map((transfer) => (
              <DownloadRow
                key={transfer.track.id}
                transfer={transfer}
                syncEnabled={sync.enabled}
                play={() => playTrack(transfer.track, downloaded)}
              />
            ))}
          </ul>
        ) : (
          <EmptyState title={copy("No individual downloads", "Нет отдельных загрузок")} />
        )}
      </section>
      <section className="flex max-w-md flex-col gap-3">
        <h2 className="text-xl">{copy("Server connection", "Подключение к серверу")}</h2>
        <ConnectionForm locale={locale} initial={status} />
      </section>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={status.keepInTray}
          disabled={command.isPending}
          onChange={(event) =>
            command.mutate({ path: "/window", body: { keepInTray: event.target.checked } })
          }
        />
        {copy(
          "Keep Caimack running in the tray when the window closes",
          "Оставлять Caimack в трее после закрытия окна",
        )}
      </label>
    </div>
  );
}

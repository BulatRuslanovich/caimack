// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useEffect, useState } from "react";
import {
  queryOptions,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  Clock3Icon,
  PlusIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/contexts/I18nContext";
import { ProviderArtwork } from "@/integrations/ui";
import { MusicSourceIcon } from "@/integrations/MusicSourceIcon";
import { formatDuration } from "@/lib/format";
import {
  musicApi,
  searchMusic,
  type MusicCandidate,
  type MusicEvent,
  type MusicImport,
  type MusicSearchKind,
  type MusicSource,
  type PlaylistSnapshot,
} from "@/integrations/music";
import { PlaylistImportPanel } from "./PlaylistImportPanel";

export function MusicSearch({
  query,
  searchEnabled,
  linkImportEnabled,
  selection,
  sources,
  kind,
  link,
  linkPending,
  onQuery,
}: {
  query: string;
  searchEnabled: boolean;
  linkImportEnabled: boolean;
  selection: string[];
  sources: MusicSource[];
  kind: MusicSearchKind;
  link: boolean;
  linkPending: boolean;
  onQuery: (query: string) => void;
}) {
  const t = useT();
  const client = useQueryClient();
  const selectedKey = selection.join(",");
  const queryKey = JSON.stringify([kind, selectedKey, query]);
  const linkSource = useQuery({
    queryKey: ["music-playlist-source", query],
    queryFn: ({ signal }) => musicApi.playlistSource(query, signal),
    enabled: link,
    retry: false,
    refetchInterval: (state) => (state.state.data?.id === "vk" ? 5_000 : false),
  });
  const source = linkSource.data;
  const catalog = new Map(sources.map((entry) => [entry.id, entry]));
  const labelFor = (id: string) => catalog.get(id)?.name ?? id;
  const hasAudio = (id: string) => {
    const entry = catalog.get(id);
    return !!entry?.capabilities.audio && (entry.audioStatus ?? entry.status) === "ready";
  };
  const audioSources = selection.filter(hasAudio);
  const importSources =
    source?.capabilities.audio && !audioSources.includes(source.id)
      ? [...audioSources, source.id]
      : audioSources;
  const [stream, setStream] = useState<{
    key: string;
    events: MusicEvent[];
    finished?: boolean;
    error?: boolean;
  }>();
  const [imports, setImports] = useState<Record<string, string>>({});
  const [review, setReview] = useState<{
    job: string;
    position: number;
    title: string;
    origin: string;
  }>();
  const [preview, setPreview] = useState<{
    query: string;
    previewId: string;
    playlist: PlaylistSnapshot;
  }>();
  const importIds = new Set(Object.values(imports));
  const jobs = useQuery({
    queryKey: ["music-imports"],
    queryFn: ({ signal }) => musicApi.list(signal),
    enabled: importIds.size > 0,
    refetchInterval: (state) =>
      state.state.data?.some(
        (job) => importIds.has(job.id) && ["queued", "running", "waiting"].includes(job.state),
      )
        ? 1500
        : false,
  });

  const start = useMutation({
    mutationFn: musicApi.start,
    onSuccess: ({ id }, request) => {
      const key = request.kind === "track" ? trackImportKey(request.candidate) : request.url;
      setImports((current) => ({ ...current, [key]: id }));
      void client.invalidateQueries({ queryKey: ["music-imports"] });
    },
  });
  const pick = useMutation({
    mutationFn: (candidate: MusicCandidate) =>
      review ? musicApi.pick(review.job, review.position, query, candidate) : Promise.resolve(),
    onSuccess: () => {
      returnToImport();
      void client.invalidateQueries({ queryKey: ["music-imports"] });
    },
  });
  const read = useMutation({
    mutationFn: (url: string) => musicApi.playlist(url),
    onSuccess: (result, url) => setPreview({ query: url, ...result }),
  });

  const shouldSearch = searchEnabled || review !== undefined;
  useEffect(() => {
    if (!shouldSearch || link || query.length < 2 || query.length > 200 || !selectedKey) return;
    const controller = new AbortController();
    const events: MusicEvent[] = [];
    void searchMusic(
      query,
      selectedKey.split(","),
      controller.signal,
      (event) => {
        if (controller.signal.aborted) return;
        events.push(event);
        setStream({ key: queryKey, events: [...events] });
      },
      kind,
    )
      .then(() => {
        if (!controller.signal.aborted) {
          setStream({ key: queryKey, events: [...events], finished: true });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStream({ key: queryKey, events: [...events], error: true });
        }
      });
    return () => controller.abort();
  }, [shouldSearch, query, link, selectedKey, kind, queryKey]);

  const activeStream = stream?.key === queryKey ? stream : undefined;
  const events = activeStream?.events ?? [];
  const groups = events.findLast((event) => event.groups)?.groups ?? [];
  const albums =
    kind === "tracks"
      ? []
      : events.flatMap(({ albums, source }) =>
          (albums ?? []).map((album) => ({ ...album, source })),
        );

  const failures = events.filter((event) => event.error);
  const snapshot = preview?.query === query ? preview.playlist : undefined;
  const readError = read.variables === query ? read.error : null;
  const playlistImportId = link ? imports[query] : undefined;
  const playlistJob = jobs.data?.find((job) => job.id === playlistImportId);
  const finishedCount = jobs.data?.filter(
    (job) => importIds.has(job.id) && job.state === "finished",
  ).length;
  useEffect(() => {
    if (!finishedCount) return;
    void client.invalidateQueries({ queryKey: ["search"] });
    void client.invalidateQueries({ queryKey: ["playlists"] });
  }, [client, finishedCount]);

  function importPlaylist(allowPartial: boolean) {
    start.mutate({
      kind: "playlist",
      url: query,
      sources: importSources,
      allowPartial,
      previewId: preview?.query === query ? preview.previewId : undefined,
    });
  }

  function reviewTrack(job: string, position: number, track: MusicCandidate) {
    setReview({ job, position, title: track.title, origin: query });
    onQuery(`${track.artist} ${track.title}`.slice(0, 200));
  }

  function returnToImport() {
    if (review) onQuery(review.origin);
    setReview(undefined);
  }

  if (!link && (!shouldSearch || !selection.length) && !review) return null;

  return (
    <section className="grid min-w-0 gap-4" aria-label={t("music.externalResults")}>
      {link && (
        <PlaylistImportPanel
          title={playlistJob?.title ?? snapshot?.name ?? t("music.importLink")}
          source={source}
          preview={snapshot}
        >
          {snapshot && !importSources.length && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("music.selectAudioSources")}
            </p>
          )}
          {linkSource.error && !source && (
            <p role="alert" className="text-sm text-destructive">
              {linkSource.error.message}
            </p>
          )}
          {source && source.status !== "ready" && (
            <p role="status" className="text-sm text-muted-foreground">
              {t(`music.status.${source.status}`)}
              {" · "}
              <Link href="/settings?tab=music" className="font-medium text-primary hover:underline">
                {t("music.sourceSettings")}
              </Link>
            </p>
          )}
          {readError && (
            <p role="alert" className="text-sm text-destructive">
              {readError.message}
            </p>
          )}
          {playlistImportId ? (
            <CurrentImport job={playlistJob} labelFor={labelFor} onReview={reviewTrack} />
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              {snapshot ? (
                <Button
                  variant="primary"
                  disabled={
                    linkPending ||
                    !importSources.length ||
                    start.isPending ||
                    !snapshot.tracks.length
                  }
                  onClick={() => importPlaylist(snapshot.partial)}
                >
                  {t(snapshot.partial ? "music.importPartial" : "music.addToLibrary")}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={
                    linkPending ||
                    read.isPending ||
                    linkSource.isPending ||
                    !source ||
                    source.status !== "ready"
                  }
                  onClick={() => read.mutate(query)}
                >
                  {t(read.isPending ? "music.reading" : "music.readPlaylist")}
                </Button>
              )}
              {!snapshot && source?.status === "needsBrowser" && (
                <Button
                  disabled={linkPending || !importSources.length || start.isPending}
                  onClick={() => importPlaylist(false)}
                >
                  {t("music.queueWhenConnected")}
                </Button>
              )}
            </div>
          )}
        </PlaylistImportPanel>
      )}

      {review && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {t("music.reviewInProgress", { title: review.title })}
          <Button size="sm" variant="ghost" onClick={returnToImport}>
            {t("action.cancel")}
          </Button>
        </div>
      )}
      {shouldSearch && !link && query.length >= 2 && selection.length > 0 && (
        <div className="grid gap-3">
          <h2 className="text-base font-semibold">{t("music.externalResults")}</h2>
          {!activeStream?.finished && !activeStream?.error && !groups.length && !albums.length && (
            <div role="status" aria-label={t("music.searching")} className="grid gap-2">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-3 py-2 motion-safe:animate-pulse">
                  <span className="size-10 rounded-md bg-raised" />
                  <span className="h-3 w-40 rounded-sm bg-raised" />
                </div>
              ))}
            </div>
          )}
          {activeStream?.error && (
            <p role="alert" className="text-sm text-destructive">
              {t("music.searchFailed")}
            </p>
          )}
          {failures.length > 0 && (
            <details className="text-sm text-muted-foreground">
              <summary className="w-fit cursor-pointer focus-visible:outline-2 focus-visible:outline-ring">
                {t("music.sourcesFailed", { count: failures.length })}
              </summary>
              <ul className="mt-2 grid gap-1">
                {failures.map(({ source }) => (
                  <li key={source}>
                    {labelFor(source)} · {t("music.searchFailed")}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {activeStream?.finished &&
            groups.length === 0 &&
            albums.length === 0 &&
            failures.length < selection.length && (
              <p className="text-sm text-muted-foreground">{t("music.noTracks")}</p>
            )}
          {groups.length > 0 && (
            <ul className="w-full divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {groups.map((group) => {
                const primary = group[0];
                const coverUrl = group.find((candidate) => candidate.coverUrl)?.coverUrl;
                const usable = group.filter(
                  (candidate) => !candidate.restricted && hasAudio(candidate.source),
                );
                const key = `${primary.source}:${primary.id}`;
                const trackImportIds = group.map((candidate) => imports[trackImportKey(candidate)]);
                const job = jobs.data?.find((entry) => trackImportIds.includes(entry.id));
                const enqueue = (candidate: MusicCandidate, automatic: boolean) => {
                  if (review) pick.mutate(candidate);
                  else
                    start.mutate({
                      kind: "track",
                      candidate,
                      automatic,
                      sources: audioSources,
                      searchQuery: query,
                    });
                };
                return (
                  <li
                    key={key}
                    className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 sm:gap-4 sm:px-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <ProviderArtwork
                        url={coverUrl}
                        className="size-9 shrink-0 rounded-md sm:size-10"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium" title={primary.title}>
                          {primary.title}
                        </p>
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="truncate text-xs text-muted-foreground"
                            title={primary.artist}
                          >
                            {primary.artist}
                          </span>
                          <TrackSource
                            copies={group}
                            labelFor={labelFor}
                            hasAudio={hasAudio}
                            busy={start.isPending || pick.isPending}
                            chooseCopy={review !== undefined || group.length > 1}
                            onChoose={(candidate) => enqueue(candidate, false)}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2 sm:gap-3">
                      {primary.duration > 0 && (
                        <span className="hidden shrink-0 text-right text-xs tabular-nums text-muted-foreground md:inline">
                          {formatDuration(primary.duration)}
                        </span>
                      )}
                      {!review && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="pointer-coarse:size-11"
                          aria-label={`${t("music.addToLibrary")} · ${primary.title}`}
                          title={usable.length ? t("music.addToLibrary") : t("music.unavailable")}
                          disabled={start.isPending || !usable.length}
                          onClick={() => enqueue(usable[0], group.length > 1)}
                        >
                          <PlusIcon size={17} aria-hidden />
                        </Button>
                      )}
                    </div>
                    {trackImportIds.some(Boolean) && (
                      <div className="col-span-2 pl-12 sm:pl-[3.25rem]">
                        <CurrentImport
                          key={job?.id}
                          job={job}
                          labelFor={labelFor}
                          onReview={reviewTrack}
                          singleTrack
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {albums.length > 0 && (
            <div className="grid gap-2">
              {kind === "all" && <h3 className="text-sm font-medium">{t("nav.albums")}</h3>}
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {albums.map((album) => (
                  <li key={album.url} className="flex min-h-14 items-center gap-3 px-3 py-2">
                    <ProviderArtwork url={album.coverUrl} className="size-10 shrink-0 rounded-md" />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="truncate font-medium">{album.title}</p>
                      <p className="truncate text-muted-foreground">{album.artist}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {labelFor(album.source)}
                    </span>
                    {linkImportEnabled && (
                      <Button size="sm" onClick={() => onQuery(album.url)}>
                        {t("music.openImport")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {(start.error || pick.error) && (
        <p role="alert" className="text-sm text-destructive">
          {start.error?.message ?? pick.error?.message}
        </p>
      )}
    </section>
  );
}

function TrackSource({
  copies,
  labelFor,
  hasAudio,
  busy,
  chooseCopy,
  onChoose,
}: {
  copies: MusicCandidate[];
  labelFor: (id: string) => string;
  hasAudio: (id: string) => boolean;
  busy: boolean;
  chooseCopy: boolean;
  onChoose: (copy: MusicCandidate) => void;
}) {
  const t = useT();
  const primary = copies[0];
  const source = labelFor(primary.source);
  const quality = (copy: MusicCandidate, short = false) =>
    [
      copy.format?.toUpperCase(),
      copy.bitrate && copy.bitrate > 0
        ? short
          ? copy.bitrate
          : t("settings.qualityBitrate", { bitrate: copy.bitrate })
        : "",
    ]
      .filter(Boolean)
      .join(" ");
  const shownQuality = quality(primary, true);
  const info = (
    <>
      <MusicSourceIcon source={primary.source} size={20} />
      {shownQuality && (
        <span className="truncate text-xs font-medium tabular-nums">{shownQuality}</span>
      )}
    </>
  );
  const title = `${source} · ${quality(primary) || t("music.formatOnImport")}`;

  if (!chooseCopy) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground" title={title}>
        <span className="sr-only">{source}</span>
        {info}
      </div>
    );
  }

  const showDurations = copies.some((copy) => copy.duration !== primary.duration);

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="auto"
          className="h-6 shrink-0 justify-start gap-1.5 rounded-sm px-1 text-muted-foreground"
          title={title}
          aria-label={`${title} · ${t("music.copies", { count: copies.length })}`}
        >
          {info}
          <ChevronDownIcon size={13} className="text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-[calc(100vw-1.5rem)]">
        {copies.map((copy) => {
          const available = hasAudio(copy.source);
          return (
            <DropdownMenuItem
              key={trackImportKey(copy)}
              disabled={copy.restricted || !available || busy}
              onSelect={() => onChoose(copy)}
              className="gap-2.5"
            >
              <MusicSourceIcon source={copy.source} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{labelFor(copy.source)}</span>
                <span className="block text-xs text-muted-foreground">
                  {copy.restricted
                    ? t("music.unavailable")
                    : !available
                      ? t("music.searchOnly")
                      : quality(copy) || t("music.formatOnImport")}
                </span>
              </span>
              {showDurations && copy.duration > 0 && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {formatDuration(copy.duration)}
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function trackImportKey(track: MusicCandidate) {
  return `${track.source}:${track.id}`;
}

function importItemsQuery(job: MusicImport | undefined, page: number) {
  return queryOptions({
    queryKey: ["music-import-items", job?.id, page, job?.done],
    queryFn: job ? ({ signal }) => musicApi.items(job.id, page, signal) : skipToken,
  });
}

function useImportAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "cancel" | "retry" | number }) =>
      typeof action === "number" ? musicApi.upgrade(id, action) : musicApi[action](id),
    onSuccess: (_, { id, action }) => {
      void client.invalidateQueries({ queryKey: ["music-imports"] });
      void client.invalidateQueries({ queryKey: ["music-import-items", id] });
      if (typeof action === "number") {
        void client.invalidateQueries({ queryKey: ["search"] });
        void client.invalidateQueries({ queryKey: ["tracks"] });
      }
    },
  });
}

function CurrentImport({
  job,
  labelFor,
  onReview,
  singleTrack = false,
}: {
  job?: MusicImport;
  labelFor: (id: string) => string;
  onReview: (job: string, position: number, track: MusicCandidate) => void;
  singleTrack?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const trackFinished = singleTrack && job?.state === "finished" && job.total === 1;
  const { data } = useQuery({ ...importItemsQuery(job, 0), enabled: trackFinished });
  const item = trackFinished ? data?.[0] : undefined;
  const act = useImportAction();

  if (!job) {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {t("music.state.queued")}
      </p>
    );
  }

  const failed = Boolean(job.error || job.failed > 0 || job.state === "cancelled");
  const StatusIcon = failed
    ? CircleAlertIcon
    : job.state === "finished"
      ? CircleCheckIcon
      : Clock3Icon;

  return (
    <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
      <details
        className="group min-w-0 flex-1"
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm py-1.5 text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <StatusIcon
            size={15}
            className={failed ? "shrink-0 text-destructive" : "shrink-0"}
            aria-hidden
          />
          <span aria-live="polite">
            {act.isSuccess
              ? t("music.flacSaved")
              : item
                ? t(`music.item.${item.state}`)
                : t(`music.state.${job.state}`)}
            {job.total > 1 ? ` · ${job.done}/${job.total}` : ""}
            {job.failed > 0 && !item ? ` · ${t("music.downloadFailed")}` : ""}
          </span>
          <ChevronDownIcon size={13} className="shrink-0 group-open:rotate-180" aria-hidden />
        </summary>
        {expanded && (
          <ImportDetails
            job={job}
            labelFor={labelFor}
            onReview={(position, track) => onReview(job.id, position, track)}
            inlineUpgrade={singleTrack}
          />
        )}
      </details>
      {item?.upgrade && !act.isSuccess && (
        <Button
          size="sm"
          className="shrink-0"
          disabled={act.isPending}
          title={labelFor(item.upgrade.source)}
          onClick={() => act.mutate({ id: job.id, action: item.position })}
        >
          <MusicSourceIcon source={item.upgrade.source} size={16} />
          {act.isPending ? t("music.replacingFlac") : t("music.replaceFlac")}
        </Button>
      )}
      {act.error && (
        <p role="alert" className="basis-full text-destructive">
          {act.error.message}
        </p>
      )}
      {job.playlistId && (
        <Button asChild size="sm" variant="primary">
          <Link href={`/playlists/${job.playlistId}`}>{t("music.openPlaylist")}</Link>
        </Button>
      )}
    </div>
  );
}

function ImportDetails({
  job,
  labelFor,
  onReview,
  inlineUpgrade,
}: {
  job: MusicImport;
  labelFor: (id: string) => string;
  onReview: (position: number, track: MusicCandidate) => void;
  inlineUpgrade: boolean;
}) {
  const t = useT();
  const [page, setPage] = useState(0);
  const items = useQuery({
    ...importItemsQuery(job, page),
    refetchInterval: job.state === "running" ? 2500 : false,
  });
  const act = useImportAction();
  const active = ["queued", "running", "waiting"].includes(job.state);

  return (
    <div className="grid gap-3 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {active && (
          <Button
            size="sm"
            disabled={act.isPending}
            onClick={() => act.mutate({ id: job.id, action: "cancel" })}
          >
            {t("action.cancel")}
          </Button>
        )}
        {!active && (job.failed > 0 || job.error || job.state === "cancelled") && (
          <Button
            size="sm"
            disabled={act.isPending}
            onClick={() => act.mutate({ id: job.id, action: "retry" })}
          >
            {t("music.retry")}
          </Button>
        )}
        {job.partial && <span className="text-muted-foreground">{t("music.partial")}</span>}
      </div>
      {(job.error || act.error) && (
        <p role="status" className="text-muted-foreground">
          {act.error?.message ?? job.error}
        </p>
      )}
      {items.data && items.data.length > 0 && (
        <ul className="divide-y divide-border">
          {items.data.map((item) => {
            const selected = item.attempts.findLast((attempt) => attempt.state === "selected");
            return (
              <li key={item.position} className="grid gap-1 py-2">
                <p>
                  {item.track.artist} — {item.track.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(`music.item.${item.state}`)}
                  {selected ? ` · ${labelFor(selected.source)}` : ""}
                  {item.error ? ` · ${item.error}` : ""}
                </p>
                {item.attempts.some((attempt) => attempt.error) && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">{t("music.attempts")}</summary>
                    {item.attempts
                      .filter((attempt) => attempt.error)
                      .map((attempt, index) => (
                        <p key={index}>
                          {labelFor(attempt.source)} · {attempt.error}
                        </p>
                      ))}
                  </details>
                )}
                {!active && (item.state === "review" || item.state === "failed") && (
                  <Button
                    className="w-fit"
                    size="sm"
                    onClick={() => onReview(item.position, item.track)}
                  >
                    {t("music.chooseManually")}
                  </Button>
                )}
                {item.upgrade && !active && !inlineUpgrade && (
                  <Button
                    className="w-fit"
                    size="sm"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ id: job.id, action: item.position })}
                  >
                    {t("music.replaceFlac")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {job.total > 100 && (
        <div className="flex gap-2">
          <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
            {t("music.previous")}
          </Button>
          <Button
            size="sm"
            disabled={(page + 1) * 100 >= job.total}
            onClick={() => setPage(page + 1)}
          >
            {t("music.next")}
          </Button>
        </div>
      )}
    </div>
  );
}

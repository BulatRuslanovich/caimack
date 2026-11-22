// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useMutation } from "@tanstack/react-query";
import { DownloadIcon, MusicIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { LoadError } from "@/components/Query";
import { SearchField } from "@/components/SearchField";
import { VkPlaylistImport } from "./VkPlaylistImport";
import { Button } from "@/components/ui/button";
import { useT } from "@/contexts/I18nContext";
import { formatDuration } from "@/lib/format";
import { SEARCH_MIN_LENGTH } from "@/lib/queries";
import { useInvalidate } from "@/lib/useInvalidate";
import { useToast } from "@/lib/useToast";
import { VkMusicError, importVkMusic, searchVkMusic } from "./vkMusic";

const VK_MUSIC_URL = "https://vk.ru/audio";

export function VkMusicSearch({
  query,
  onChange,
}: {
  query: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const router = useRouter();
  const { notify } = useToast();
  const invalidate = useInvalidate();
  const inputRef = useRef<HTMLInputElement>(null);
  const search = useMutation({
    mutationFn: searchVkMusic,
    meta: { handlesError: true },
  });
  const [imported, setImported] = useState<Set<string>>(() => new Set());
  const [uploading, setUploading] = useState(false);
  const [playlistImporting, setPlaylistImporting] = useState(false);

  const download = useMutation({
    meta: { handlesError: true },
    mutationFn: async ({ text, id }: { text: string; id: string }) => {
      const result = await importVkMusic(text, id, () => setUploading(true));
      if (result.failed[0]) throw new Error(result.failed[0].reason);
      if (result.uploaded.length === 0) throw new VkMusicError("unavailable");
    },
    onSuccess: (_, { id }) => {
      setImported((current) => new Set(current).add(id));
      invalidate("library");
      notify(t("vkMusic.added"), "success");
    },
    onError: (error) => {
      const code = error instanceof VkMusicError ? error.code : null;
      const offerUpload =
        code === "mediaHost" || code === "mediaMissing" || code === "mediaPlayerOnly";
      notify(
        code ? t(`vkMusic.error.${code}`) : error.message,
        "error",
        offerUpload ? { label: t("nav.upload"), run: () => router.push("/upload") } : undefined,
      );
    },
    onSettled: () => setUploading(false),
  });

  function submit(value: string) {
    if (
      search.isPending ||
      download.isPending ||
      playlistImporting ||
      value.length < SEARCH_MIN_LENGTH
    )
      return;
    onChange(value);
    search.mutate(value);
  }

  const submitted = search.variables === query;
  const searchError = submitted && search.error;
  const tracks = submitted ? search.data : undefined;
  return (
    <>
      <div className="flex items-center gap-2">
        <SearchField
          value={query}
          onChange={onChange}
          onSubmit={submit}
          inputRef={inputRef}
          className="min-w-0 flex-1"
          placeholder={t("vkMusic.placeholder")}
          autoFocus
        />
        <Button
          variant="primary"
          disabled={search.isPending || download.isPending || playlistImporting}
          onClick={() => submit(inputRef.current?.value.trim() ?? query)}
        >
          {t("vkMusic.search")}
        </Button>
      </div>
      <div>
        <VkPlaylistImport
          disabled={search.isPending || download.isPending}
          onImporting={setPlaylistImporting}
        />
      </div>
      {search.isPending ? (
        <p role="status" className="px-2.5 py-3 text-sm text-muted-foreground">
          {t("vkMusic.searching")}
        </p>
      ) : searchError ? (
        <LoadError
          message={
            searchError instanceof VkMusicError
              ? t(`vkMusic.error.${searchError.code}`)
              : t("vkMusic.error.vkChanged")
          }
          onRetry={() => submit(query)}
        />
      ) : tracks?.length === 0 ? (
        <EmptyState icon={<SearchIcon size={24} />} title={t("search.nothingFound")} />
      ) : tracks ? (
        <ul aria-label={t("nav.tracks")} className="divide-y divide-border">
          {tracks.map((track) => {
            const active = download.isPending && download.variables?.id === track.id;
            const added = imported.has(track.id);
            return (
              <li key={track.id} className="flex min-h-14 items-center gap-3 px-2.5 py-1.5">
                <MusicIcon size={17} className="shrink-0 text-faint max-sm:hidden" aria-hidden />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{track.title}</span>
                  <span className="truncate text-sm text-muted-foreground">{track.artist}</span>
                </div>
                {track.duration > 0 && (
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                    {formatDuration(track.duration)}
                  </span>
                )}
                {track.restricted ? (
                  <span className="text-sm text-faint">{t("vkMusic.restricted")}</span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={added || download.isPending || playlistImporting}
                    aria-label={
                      active || added ? undefined : t("vkMusic.addTrack", { name: track.title })
                    }
                    onClick={() => download.mutate({ text: query, id: track.id })}
                  >
                    {!active && !added && <DownloadIcon size={14} aria-hidden />}
                    {active
                      ? t(uploading ? "vkMusic.uploading" : "vkMusic.downloading")
                      : t(added ? "vkMusic.inLibrary" : "vkMusic.add")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={<SearchIcon size={24} />}
          title={t("vkMusic.title")}
          description={t("vkMusic.startHint")}
          action={
            <Button asChild size="sm">
              <a href={VK_MUSIC_URL} target="_blank" rel="noreferrer">
                {t("vkMusic.open")}
              </a>
            </Button>
          }
        />
      )}
    </>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { yandexApi, yandexQueries } from "./api";
import { readStoredJson, writeStoredJson } from "@/lib/storage";
import { useInvalidate } from "@/lib/useInvalidate";
import { useYandexMusicSettings } from "./useYandexMusic";
import type { YandexImport, YandexImportKind } from "./types";
import { useAuth } from "@/contexts/AuthContext";

export interface YandexSource {
  kind: YandexImportKind;
  id?: string;
  title: string;
  artist?: string;
  coverUrl?: string | null;
}

type SourceLink = YandexSource & { jobId: string };
type Sources = Record<string, SourceLink>;

export const yandexSourceKey = (source: Pick<YandexSource, "kind" | "id">) =>
  `${source.kind}:${source.id ?? ""}`;
export const isYandexImportActive = (job: YandexImport) =>
  job.status === "Queued" || job.status === "Running";

interface YandexMusicImports {
  jobs: YandexImport[];
  sources: Sources;
  pending: ReadonlySet<string>;
  errors: Record<string, string>;
  loading: boolean;
  failed: boolean;
  removing: boolean;
  start: (source: YandexSource) => Promise<YandexImport | undefined>;
  remove: (id: string) => void;
  refresh: () => void;
}

const Context = createContext<YandexMusicImports | null>(null);

function readSources(key: string): Sources {
  const stored = readStoredJson(key);
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  return Object.fromEntries(
    Object.entries(stored)
      .filter(([, value]) => {
        if (!value || typeof value !== "object") return false;
        const source = value as Partial<SourceLink>;
        return (
          typeof source.jobId === "string" &&
          typeof source.title === "string" &&
          ["Track", "Album", "Likes", "Playlist"].includes(source.kind ?? "") &&
          (source.id === undefined || typeof source.id === "string")
        );
      })
      .slice(-100),
  );
}

export function YandexMusicProvider({
  children,
  available,
}: {
  children: ReactNode;
  available: boolean;
}) {
  const { user } = useAuth();
  const settings = useYandexMusicSettings();
  const userId = user?.id ?? "guest";
  return (
    <YandexMusicState key={userId} userId={userId} enabled={available && settings.enabled}>
      {children}
    </YandexMusicState>
  );
}

function YandexMusicState({
  children,
  userId,
  enabled,
}: {
  children: ReactNode;
  userId: string;
  enabled: boolean;
}) {
  const client = useQueryClient();
  const invalidate = useInvalidate();
  const importQuery = yandexQueries.yandexImports(userId);
  const imports = useQuery({
    ...importQuery,
    enabled,
    refetchOnWindowFocus: true,
  });
  const storageKey = `music-streaming.yandex-sources.${userId}`;
  const [sources, setSources] = useState<Sources>(() => readSources(storageKey));
  const sourcesRef = useRef(sources);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const observed = useRef(
    new Map<string, { added: number; status: string; playlistId?: string }>(),
  );

  const jobs = imports.data;
  useEffect(() => {
    if (!jobs) return;
    let changed = false;
    let finished = false;
    let playlistCreated = false;
    for (const job of jobs) {
      const before = observed.current.get(job.id);
      if (before && (job.added > before.added || job.status !== before.status)) {
        changed ||= job.added > before.added;
        finished ||= !isYandexImportActive(job);
      }
      playlistCreated ||= Boolean(job.playlistId && job.playlistId !== before?.playlistId);
      observed.current.set(job.id, {
        added: job.added,
        status: job.status,
        playlistId: job.playlistId,
      });
    }
    if (changed || finished) invalidate("library");
    if (playlistCreated) invalidate("playlists");
    if (finished) void client.invalidateQueries({ queryKey: ["yandexSearch"] });
  }, [jobs, client, invalidate]);

  const mutation = useMutation({
    meta: { handlesError: true },
    mutationFn: (source: YandexSource) => yandexApi.startYandexImport(source.kind, source.id),
    onSuccess: (job, source) => {
      const next = {
        ...sourcesRef.current,
        [yandexSourceKey(source)]: { ...source, jobId: job.id },
      };
      const bounded = Object.fromEntries(Object.entries(next).slice(-100));
      sourcesRef.current = bounded;
      setSources(bounded);
      writeStoredJson(storageKey, bounded);
      client.setQueryData<YandexImport[]>(importQuery.queryKey, (previous = []) => [
        job,
        ...previous.filter((each) => each.id !== job.id),
      ]);
      void client.invalidateQueries({ queryKey: importQuery.queryKey });
    },
    onError: (error, source) => {
      setErrors((previous) => ({ ...previous, [yandexSourceKey(source)]: error.message }));
    },
    onSettled: (_data, _error, source) => {
      pendingRef.current.delete(yandexSourceKey(source));
      setPending(new Set(pendingRef.current));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => yandexApi.removeYandexImport(id),
    onSuccess: () => {
      void imports.refetch();
    },
  });

  const start = async (source: YandexSource) => {
    const key = yandexSourceKey(source);
    if (pendingRef.current.has(key)) return;
    const job = jobs?.find((each) => each.id === sourcesRef.current[key]?.jobId);
    if (job && isYandexImportActive(job)) return job;
    pendingRef.current.add(key);
    setPending(new Set(pendingRef.current));
    setErrors((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    try {
      return await mutation.mutateAsync(source);
    } catch {
      // The import button or dialog reads the error stored by the mutation.
      return undefined;
    }
  };

  return (
    <Context.Provider
      value={{
        jobs: jobs ?? [],
        sources,
        pending,
        errors,
        loading: imports.isLoading,
        failed: imports.isError,
        removing: remove.isPending,
        start,
        remove: remove.mutate,
        refresh: () => {
          void imports.refetch();
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useYandexImports() {
  const value = useContext(Context);
  if (!value) throw new Error("YandexMusicProvider is missing");
  return value;
}

// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { queries } from "@/lib/queries";
import { readStoredJson, writeStoredJson } from "@/lib/storage";
import { useInvalidate } from "@/lib/useInvalidate";
import { useYandexMusicSettings } from "@/lib/useYandexMusic";
import type { YandexImport, YandexImportKind } from "@/lib/types";
import { useAuth } from "./AuthContext";

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
  activityOpen: boolean;
  setActivityOpen: (value: boolean) => void;
  start: (source: YandexSource) => void;
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
          ["Track", "Album", "Likes"].includes(source.kind ?? "") &&
          (source.id === undefined || typeof source.id === "string")
        );
      })
      .slice(-100),
  );
}

export function YandexMusicProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useAuth();
  const settings = useYandexMusicSettings();
  return (
    <YandexMusicState
      key={user?.id ?? "guest"}
      storageKey={`music-streaming.yandex-sources.${user?.id ?? "guest"}`}
      enabled={isAdmin && settings.enabled}
    >
      {children}
    </YandexMusicState>
  );
}

function YandexMusicState({
  children,
  storageKey,
  enabled,
}: {
  children: ReactNode;
  storageKey: string;
  enabled: boolean;
}) {
  const client = useQueryClient();
  const invalidate = useInvalidate();
  const imports = useQuery({ ...queries.yandexImports(), enabled, refetchOnWindowFocus: true });
  const [sources, setSources] = useState<Sources>(() => readSources(storageKey));
  const sourcesRef = useRef(sources);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activityOpen, setActivityOpen] = useState(false);
  const observed = useRef(new Map<string, { added: number; status: string }>());

  const jobs = imports.data;
  useEffect(() => {
    if (!jobs) return;
    let changed = false;
    let finished = false;
    for (const job of jobs) {
      const before = observed.current.get(job.id);
      if (before && (job.added > before.added || job.status !== before.status)) {
        changed ||= job.added > before.added;
        finished ||= !isYandexImportActive(job);
      }
      observed.current.set(job.id, { added: job.added, status: job.status });
    }
    if (changed || finished) invalidate("library");
    if (finished) void client.invalidateQueries({ queryKey: ["yandexSearch"] });
  }, [jobs, client, invalidate]);

  const mutation = useMutation({
    meta: { handlesError: true },
    mutationFn: (source: YandexSource) => api.startYandexImport(source.kind, source.id),
    onSuccess: (job, source) => {
      const next = {
        ...sourcesRef.current,
        [yandexSourceKey(source)]: { ...source, jobId: job.id },
      };
      const bounded = Object.fromEntries(Object.entries(next).slice(-100));
      sourcesRef.current = bounded;
      setSources(bounded);
      writeStoredJson(storageKey, bounded);
      client.setQueryData<YandexImport[]>(["yandexImports"], (previous = []) => [
        job,
        ...previous.filter((each) => each.id !== job.id),
      ]);
      void client.invalidateQueries({ queryKey: ["yandexImports"] });
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
    mutationFn: (id: string) => api.removeYandexImport(id),
    onSuccess: () => {
      void imports.refetch();
    },
  });

  const start = (source: YandexSource) => {
    const key = yandexSourceKey(source);
    if (pendingRef.current.has(key)) return;
    const job = jobs?.find((each) => each.id === sourcesRef.current[key]?.jobId);
    if (job && isYandexImportActive(job)) return;
    pendingRef.current.add(key);
    setPending(new Set(pendingRef.current));
    setErrors((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    mutation.mutate(source);
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
        activityOpen,
        setActivityOpen,
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

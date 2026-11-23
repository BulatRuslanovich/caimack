// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useSyncExternalStore } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { readStored, writeStored, writeStoredJson } from "@/lib/storage";
import { musicApi } from "./music";
import { useAvailableIntegrations } from "./registry";
import { VK_CONNECTION_QUERY, vkMusicConnection, type VkMusicConnection } from "./vk/vkMusic";
import { useYandexMusicSettings } from "./yandex/useYandexMusic";

const DISABLED_SOURCES_KEY = "caimack.musicSources.disabled";
const EXTERNAL_SEARCH_KEY = "caimack.musicSources.externalSearch";
const PLAYLIST_IMPORT_KEY = "caimack.musicSources.playlistImport";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === DISABLED_SOURCES_KEY ||
      event.key === EXTERNAL_SEARCH_KEY ||
      event.key === PLAYLIST_IMPORT_KEY ||
      event.key === null
    ) {
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function disabledSources(value: string | null): string[] {
  try {
    const sources: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(sources)
      ? sources.filter((source): source is string => typeof source === "string")
      : [];
  } catch {
    return [];
  }
}

export function useMusicDefaults() {
  const value = useSyncExternalStore(
    subscribe,
    () => readStored(DISABLED_SOURCES_KEY),
    () => null,
  );
  return disabledSources(value);
}

export function setMusicDefault(id: string, enabled: boolean) {
  const disabled = new Set(disabledSources(readStored(DISABLED_SOURCES_KEY)));
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  writeStoredJson(DISABLED_SOURCES_KEY, [...disabled]);
  listeners.forEach((listener) => listener());
}

export function useExternalMusicSearch() {
  return useSyncExternalStore(
    subscribe,
    () => readStored(EXTERNAL_SEARCH_KEY) !== "off",
    () => false,
  );
}

export function setExternalMusicSearch(enabled: boolean) {
  writeStored(EXTERNAL_SEARCH_KEY, enabled ? null : "off");
  listeners.forEach((listener) => listener());
}

export function usePlaylistLinkImport() {
  return useSyncExternalStore<boolean | null>(
    subscribe,
    () => readStored(PLAYLIST_IMPORT_KEY) !== "off",
    () => null,
  );
}

export function setPlaylistLinkImport(enabled: boolean) {
  writeStored(PLAYLIST_IMPORT_KEY, enabled ? null : "off");
  listeners.forEach((listener) => listener());
}

export function useMusicSources(enabled: boolean) {
  const native = useAvailableIntegrations();
  const { hasToken } = useYandexMusicSettings();
  const { data: vk } = useQuery<VkMusicConnection>({
    queryKey: VK_CONNECTION_QUERY,
    queryFn: vkMusicConnection,
    enabled: false,
  });
  const catalog = useQuery({
    queryKey: ["music-sources", hasToken],
    queryFn: ({ signal }) => musicApi.sources(signal),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const sources = (catalog.data ?? []).flatMap((source) => {
    if (source.id === "vk" || source.id === "yandex") {
      if (!native.some(({ id }) => id === source.id)) return [];
      if (source.id === "vk" && vk !== "ready") {
        return [
          { ...source, status: "needsBrowser" as const, audioStatus: "needsBrowser" as const },
        ];
      }
      if (source.id === "yandex" && !hasToken) {
        return [{ ...source, status: "needsToken" as const, audioStatus: "needsToken" as const }];
      }
    }
    return [source];
  });
  return { sources, catalog, vk };
}

// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useSyncExternalStore } from "react";
import type { Track, User } from "@/lib/types";
import { isDesktop } from "./runtime";

export { isDesktop } from "./runtime";

export type Transfer = {
  track: Track;
  status: "queued" | "running" | "failed" | "complete";
  bytes: number;
  total: number | null;
  error?: string | null;
};

export type DesktopStatus = {
  server: string | null;
  allowHttp: boolean;
  user: User | null;
  online: boolean;
  keepInTray: boolean;
  downloads: Transfer[];
  localTracks: Record<string, "original" | "hls">;
  autoDownloads: boolean;
  sync: {
    folder: string | null;
    enabled: boolean;
    paused: boolean;
    running: boolean;
    completed: number;
    total: number;
    bytes: number;
    trackBytes: number;
    size: number;
    lastAt: string | null;
    error: string | null;
    pending: number;
    rejected: { id: string; message: string }[];
  };
};

export async function desktopRequest<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(
    "/desktop" + path,
    body === undefined
      ? undefined
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(error?.detail ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

let status: DesktopStatus | null = null;
let serialized = "";
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Promise<DesktopStatus> | null = null;
const listeners = new Set<() => void>();
let downloadedTracks = new Set<string>();

export function refreshDesktop(): Promise<DesktopStatus> {
  pending ??= desktopRequest<DesktopStatus>("/status")
    .then((next) => {
      const json = JSON.stringify(next);
      if (json !== serialized) {
        const reconnected = status && !status.online && next.online;
        const synced = status && next.sync.lastAt && status.sync.lastAt !== next.sync.lastAt;
        const signedOut = status?.user && !next.user;
        status = next;
        downloadedTracks = new Set(
          next.downloads.filter((item) => item.status === "complete").map((item) => item.track.id),
        );
        serialized = json;
        listeners.forEach((listener) => listener());
        if (reconnected || synced) window.dispatchEvent(new Event("caimack:refetch"));
        if (signedOut && location.pathname !== "/login")
          window.dispatchEvent(new Event("caimack:signed-out"));
      }
      return next;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

function poll() {
  void refreshDesktop()
    .catch(() => {})
    .finally(() => {
      timer = setTimeout(poll, 1200);
    });
}

export function startDesktopStatus() {
  if (timer === null) timer = setTimeout(poll, 0);
}

function subscribe(listener: () => void) {
  if (!isDesktop) return () => {};
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDesktopStatus() {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => null,
  );
}

export function useDesktopDownloaded(id: string) {
  return useSyncExternalStore(
    subscribe,
    () => !status?.sync.enabled && downloadedTracks.has(id),
    () => false,
  );
}

export function useDesktopOffline() {
  return useSyncExternalStore(
    subscribe,
    () => status?.online === false,
    () => false,
  );
}

export function useDesktopOfflinePlayback() {
  const check = () => Boolean(status && (!status.online || status.sync.enabled));
  return useSyncExternalStore(subscribe, check, () => false);
}

export function useDesktopUnavailable(id: string) {
  const check = () => !canPlayLocally(id);
  return useSyncExternalStore(subscribe, check, () => false);
}

export function canPlayLocally(id: string) {
  return !isDesktop || !status || status.online || !!status.localTracks[id];
}

export function localSource(id: string) {
  return isDesktop ? status?.localTracks[id] : undefined;
}

// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useEffect, type ReactNode } from "react";
import { request } from "@/lib/http";
import { useQueryClient } from "@tanstack/react-query";
import {
  getVkPlaylist,
  searchVkMusic,
  fetchVkAudio,
  VkMusicError,
  vkMusicConnection,
  VK_CONNECTION_QUERY,
  type VkMusicConnection,
} from "./vkMusic";

type Ticket = { id: string } & (
  | { action: "search"; query: string }
  | { action: "playlist"; source: string }
  | { action: "download"; query: string; trackId: string }
  | { action: "playlistTrack"; source: string; trackId: string }
);

async function answer(ticket: Ticket) {
  switch (ticket.action) {
    case "search":
      return searchVkMusic(ticket.query);
    case "playlist":
      return getVkPlaylist(ticket.source);
    case "download":
      return fetchVkAudio({ query: ticket.query, trackId: ticket.trackId });
    case "playlistTrack":
      return fetchVkAudio({ source: ticket.source, trackId: ticket.trackId });
  }
}

export function MusicBrowserRuntime({
  available,
  children,
}: {
  available: boolean;
  children: ReactNode;
}) {
  const client = useQueryClient();

  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    const { signal } = controller;
    let timer: number | undefined;
    let status: VkMusicConnection | undefined;
    let nextProbe = 0;
    let connected = false;

    async function poll() {
      try {
        if (Date.now() >= nextProbe) {
          status = await vkMusicConnection();
          if (signal.aborted) return;
          client.setQueryData(VK_CONNECTION_QUERY, status);
          nextProbe = Date.now() + 5_000;
        }
        if (status !== "ready") {
          connected = false;
          return;
        }
        const ticket = await request<Ticket | null>("/music/browser", { signal });
        if (!connected && !signal.aborted) {
          connected = true;
          void client.invalidateQueries({ queryKey: ["music-sources"] });
        }
        if (!ticket || signal.aborted) return;
        const reply = await answer(ticket)
          .then((value) => ({ value }))
          .catch((error: unknown) => ({
            error: error instanceof VkMusicError ? error.code : "unavailable",
          }));
        if (!signal.aborted) {
          await request<void>(`/music/browser/${ticket.id}`, {
            signal,
            method: "POST",
            body: reply,
          });
        }
      } catch {
        connected = false;
        // The server may have discarded a request after the query was cancelled.
      } finally {
        if (!signal.aborted) timer = window.setTimeout(poll, status === "ready" ? 1250 : 5000);
      }
    }

    void poll();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [available, client]);

  return children;
}

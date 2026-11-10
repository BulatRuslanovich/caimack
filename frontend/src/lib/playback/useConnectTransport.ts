// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { api } from "@/lib/api";
import { deviceId } from "@/lib/events";
import { API_BASE, qs, refreshSession } from "@/lib/http";
import type { Track } from "@/lib/types";
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import type { ConnectCommand, ConnectEnvelope, ConnectSnapshot } from "./connect";
import { applyConnectCommand } from "./connectCommands";
import { deviceName } from "./deviceName";
import type { PlayerActions, PlayerProgress, PlayerState } from "./playerTypes";
import type { RemoteView } from "./useRemotePlaybackView";

export interface ConnectRenderer {
  local: PlayerState;
  localActions: PlayerActions;
  localProgress: PlayerProgress;
  output: (enabled: boolean) => void;
  load: (tracks: Track[], command: Extract<ConnectCommand, { type: "play" }>) => void;
  selectedId: string | null;
  remote: RemoteView | null;
  connected: boolean;
}
interface TransportInput {
  userId: string | null;
  ownRef: RefObject<string | null>;
  connectionRef: RefObject<string | null>;
  currentSnapshotRef: RefObject<ConnectSnapshot>;
  latestRef: RefObject<ConnectRenderer>;
  wantsLocalRef: RefObject<boolean>;
  executionChainRef: RefObject<Promise<void>>;
  receive: (snapshot: ConnectSnapshot) => void;
  report: (signal?: AbortSignal) => Promise<void>;
  setConnected: Dispatch<SetStateAction<boolean>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setLease: Dispatch<SetStateAction<boolean>>;
}

export function useConnectTransport({
  userId,
  ownRef,
  connectionRef,
  currentSnapshotRef,
  latestRef,
  wantsLocalRef,
  executionChainRef,
  receive,
  report,
  setConnected,
  setSelectedId,
  setLease,
}: TransportInput) {
  useEffect(() => {
    if (!userId) return;
    ownRef.current = deviceId();
    let stopped = false;
    let source: EventSource | null = null;
    let retry: number | null = null;
    const executed = new Set<string>();
    const executing = new Set<AbortController>();
    const open = () => {
      if (stopped) return;
      source = new EventSource(
        `${API_BASE}/playback/connect/events${qs({ deviceId: ownRef.current ?? undefined, deviceName: deviceName() })}`,
      );
      source.addEventListener("snapshot", (event) => {
        if (stopped) return;
        try {
          receive(JSON.parse(event.data) as ConnectSnapshot);
          setConnected(true);
        } catch {
          /* Ignore malformed events; reconnect supplies a complete snapshot. */
        }
      });
      source.addEventListener("command", (event) => {
        let envelope: ConnectEnvelope;
        try {
          envelope = JSON.parse(event.data) as ConnectEnvelope;
        } catch {
          return;
        }
        executionChainRef.current = executionChainRef.current
          .catch(() => {})
          .then(async () => {
            if (stopped || envelope.connectionId !== connectionRef.current) return;
            let error: string | null = null;
            const cancellation = new AbortController();
            executing.add(cancellation);
            const deadline = window.setTimeout(
              () => cancellation.abort(),
              Math.max(0, Date.parse(envelope.expiresAt) - Date.now()),
            );
            try {
              if (Date.parse(envelope.expiresAt) < Date.now())
                throw new Error("Playback command expired.");
              if (!executed.has(envelope.id)) {
                if (envelope.queueRevision !== null) await report(cancellation.signal);
                if (
                  envelope.queueRevision !== null &&
                  currentSnapshotRef.current.playback?.queueRevision !== envelope.queueRevision
                )
                  throw new Error("The playback queue changed.");
                await applyConnectCommand(
                  envelope.command,
                  latestRef.current.local,
                  latestRef.current.localActions,
                  (tracks, command) => {
                    cancellation.signal.throwIfAborted();
                    wantsLocalRef.current = true;
                    flushSync(() => {
                      setSelectedId(null);
                      setLease(true);
                      latestRef.current.output(true);
                      latestRef.current.load(tracks, command);
                    });
                  },
                  cancellation.signal,
                );
                if (envelope.command.type === "startRadio") {
                  wantsLocalRef.current = true;
                  flushSync(() => {
                    setSelectedId(null);
                    setLease(true);
                    latestRef.current.output(true);
                  });
                }
                executed.add(envelope.id);
                if (executed.size > 128) executed.delete(executed.values().next().value!);
                // Let React commit the renderer state before publishing it and acknowledging.
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
                for (let attempt = 0; ; attempt++) {
                  cancellation.signal.throwIfAborted();
                  try {
                    await report(cancellation.signal);
                    break;
                  } catch (reason) {
                    if (attempt >= 9) throw reason;
                    await new Promise((resolve) => setTimeout(resolve, 100));
                  }
                }
              }
            } catch (reason) {
              error = reason instanceof Error ? reason.message : "Playback command failed.";
            } finally {
              window.clearTimeout(deadline);
              executing.delete(cancellation);
            }
            if (!stopped)
              await api
                .connectAck(envelope.id, ownRef.current!, envelope.connectionId, error)
                .catch(() => {});
          });
      });
      source.addEventListener("error", () => {
        if (stopped) return;
        for (const command of executing) command.abort();
        setConnected(false);
        source?.close();
        connectionRef.current = null;
        retry = window.setTimeout(() => {
          void refreshSession().finally(open);
        }, 1500);
      });
    };
    open();
    return () => {
      stopped = true;
      for (const command of executing) command.abort();
      source?.close();
      if (retry !== null) clearTimeout(retry);
      connectionRef.current = null;
    };
  }, [
    userId,
    ownRef,
    connectionRef,
    currentSnapshotRef,
    latestRef,
    wantsLocalRef,
    executionChainRef,
    receive,
    report,
    setConnected,
    setSelectedId,
    setLease,
  ]);

  useEffect(() => {
    if (!userId) return;
    const heartbeat = window.setInterval(() => {
      const id = connectionRef.current;
      if (id && ownRef.current)
        void api.connectHeartbeat(ownRef.current, id).catch(() => setConnected(false));
    }, 10_000);
    return () => clearInterval(heartbeat);
  }, [userId, connectionRef, ownRef, setConnected]);
}

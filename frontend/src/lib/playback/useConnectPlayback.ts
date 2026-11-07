// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { api } from "@/lib/api";
import { deviceId } from "@/lib/events";
import { API_BASE, qs, refreshSession } from "@/lib/http";
import { useToast } from "@/lib/useToast";
import { useT } from "@/contexts/I18nContext";
import { useRequiredContext } from "@/lib/useRequiredContext";
import { deviceName } from "./deviceName";
import { applyConnectCommand, lookupQueue } from "./connectCommands";
import { positionAt, remoteActions, remoteState } from "./connect";
import { CommandQueue } from "./commandQueue";
import type {
  ConnectCommand,
  ConnectDevice,
  ConnectEnvelope,
  ConnectPlayback,
  ConnectSnapshot,
} from "./connect";
import type { PlayerActions, PlayerProgress, PlayerState } from "./playerTypes";
import type { Track } from "@/lib/types";

interface ConnectControls {
  devices: ConnectDevice[];
  selectedId: string | null;
  selectedName: string;
  connected: boolean;
  available: boolean;
  pending: boolean;
  select: (device: string | null) => Promise<void>;
}

export const ConnectContext = createContext<ConnectControls | null>(null);
export const useConnect = () => useRequiredContext(ConnectContext, "useConnect", "PlayerProvider");

interface RemoteView {
  active: ConnectPlayback;
  tracks: Track[];
  receivedAt: number;
}

function playbackState(
  state: PlayerState,
  progress: PlayerProgress,
): Omit<ConnectPlayback, "deviceId" | "queueRevision" | "reportedAt"> {
  return {
    trackIds: state.queue.map((track) => track.id),
    index: Math.max(0, state.currentIndex),
    order: state.queueOrder,
    positionSeconds: progress.getPosition(),
    isPlaying: state.isPlaying,
    buffering: state.buffering,
    volume: state.volume,
    muted: state.muted,
    shuffle: state.shuffle,
    repeat: state.repeat,
    radio: state.radioSession,
    crossfade: state.crossfade,
    smartTransitions: state.smartTransitions,
    normalizeVolume: state.normalizeVolume,
    autoplay: state.autoplay,
    sleepTimer: state.sleepTimer,
  };
}

export function useConnectPlayback(
  userId: string | null,
  local: PlayerState,
  localActions: PlayerActions,
  localProgress: PlayerProgress,
  output: (enabled: boolean) => void,
  load: (tracks: Track[], command: Extract<ConnectCommand, { type: "play" }>) => void,
) {
  const t = useT();
  const { notifyError, notify } = useToast();
  const [snapshot, setSnapshot] = useState<ConnectSnapshot>({
    epoch: "",
    version: 0,
    devices: [],
    playback: null,
  });
  const [connected, setConnected] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [remote, setRemote] = useState<RemoteView | null>(null);
  const [pending, setPending] = useState(0);
  const [lease, setLease] = useState(false);
  const [now, tick] = useState(0);
  const own = useRef<string | null>(null);
  const connection = useRef<string | null>(null);
  const currentSnapshot = useRef(snapshot);
  const latest = useRef({
    local,
    localActions,
    localProgress,
    output,
    load,
    selectedId,
    remote,
    connected,
  });
  const wantsLocal = useRef(false);
  const [commandQueue] = useState(() => new CommandQueue<ConnectCommand>());
  const executionChain = useRef(Promise.resolve());
  const reportChain = useRef(Promise.resolve());
  const selectionEpoch = useRef(0);
  const hydrated = useRef(0);
  useLayoutEffect(() => {
    latest.current = {
      local,
      localActions,
      localProgress,
      output,
      load,
      selectedId,
      remote,
      connected,
    };
  }, [local, localActions, localProgress, output, load, selectedId, remote, connected]);

  const receive = useCallback((next: ConnectSnapshot) => {
    if (
      next.epoch === currentSnapshot.current.epoch &&
      next.version < currentSnapshot.current.version
    )
      return;
    currentSnapshot.current = next;
    setSnapshot(next);
    connection.current =
      next.devices.find((device) => device.id === own.current)?.connectionId ?? null;
    const active = next.playback;
    const named = next.devices.find(
      (device) => device.id === (latest.current.selectedId ?? active?.deviceId),
    );
    if (named) setSelectedName(named.name);
    if (!active || active.deviceId === own.current) return;
    if (!latest.current.selectedId && !latest.current.local.isPlaying && !wantsLocal.current) {
      latest.current.localActions.pause();
      latest.current.output(false);
      setSelectedId(active.deviceId);
    }
    const revision = ++hydrated.current;
    const known = new Map(
      [...latest.current.local.queue, ...(latest.current.remote?.tracks ?? [])].map((track) => [
        track.id,
        track,
      ]),
    );
    const missing = [...new Set(active.trackIds)].filter((id) => !known.has(id));
    const finish = (tracks: Track[]) => {
      if (revision !== hydrated.current) return;
      for (const track of tracks) known.set(track.id, track);
      if (active.trackIds.some((id) => !known.has(id))) return;
      setRemote((previous) => ({
        active,
        tracks: active.trackIds.map((id) => known.get(id)!),
        receivedAt:
          previous?.active.reportedAt === active.reportedAt
            ? previous.receivedAt
            : performance.now(),
      }));
    };
    if (!missing.length) finish([]);
    else
      void lookupQueue(missing)
        .then(finish)
        .catch(() => {});
  }, []);

  const report = useCallback(
    (signal?: AbortSignal) => {
      const requestedConnection = connection.current;
      const task = reportChain.current
        .catch(() => {})
        .then(async () => {
          const value = latest.current;
          const id = connection.current;
          if (
            !id ||
            id !== requestedConnection ||
            value.selectedId ||
            (!value.local.queue.length &&
              currentSnapshot.current.playback?.deviceId !== own.current)
          )
            return;
          const next = await api.connectReport(
            own.current!,
            id,
            playbackState(value.local, value.localProgress),
            signal,
          );
          if (id === connection.current && !latest.current.selectedId) receive(next);
        });
      reportChain.current = task.catch(() => {});
      return task;
    },
    [receive],
  );

  useEffect(() => {
    if (!userId) return;
    own.current = deviceId();
    let stopped = false;
    let source: EventSource | null = null;
    let retry: number | null = null;
    const executed = new Set<string>();
    const executing = new Set<AbortController>();
    const open = () => {
      if (stopped) return;
      source = new EventSource(
        `${API_BASE}/playback/connect/events${qs({ deviceId: own.current ?? undefined, deviceName: deviceName() })}`,
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
        executionChain.current = executionChain.current
          .catch(() => {})
          .then(async () => {
            if (stopped || envelope.connectionId !== connection.current) return;
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
                  currentSnapshot.current.playback?.queueRevision !== envelope.queueRevision
                )
                  throw new Error("The playback queue changed.");
                await applyConnectCommand(
                  envelope.command,
                  latest.current.local,
                  latest.current.localActions,
                  (tracks, command) => {
                    cancellation.signal.throwIfAborted();
                    wantsLocal.current = true;
                    flushSync(() => {
                      setSelectedId(null);
                      setLease(true);
                      latest.current.output(true);
                      latest.current.load(tracks, command);
                    });
                  },
                  cancellation.signal,
                );
                if (envelope.command.type === "startRadio") {
                  wantsLocal.current = true;
                  flushSync(() => {
                    setSelectedId(null);
                    setLease(true);
                    latest.current.output(true);
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
                .connectAck(envelope.id, own.current!, envelope.connectionId, error)
                .catch(() => {});
          });
      });
      source.addEventListener("error", () => {
        if (stopped) return;
        for (const command of executing) command.abort();
        setConnected(false);
        source?.close();
        connection.current = null;
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
      connection.current = null;
    };
  }, [userId, receive, report]);

  useEffect(() => {
    if (!userId) return;
    const heartbeat = window.setInterval(() => {
      const id = connection.current;
      if (id && own.current)
        void api.connectHeartbeat(own.current, id).catch(() => setConnected(false));
    }, 10_000);
    return () => clearInterval(heartbeat);
  }, [userId]);

  useEffect(() => {
    if (!connected || selectedId) return;
    void report().catch(() => {});
    const interval = window.setInterval(() => void report().catch(() => {}), 2000);
    return () => clearInterval(interval);
  }, [connected, selectedId, local, report]);

  const available =
    connected &&
    (selectedId === null || snapshot.devices.some((device) => device.id === selectedId));
  const send = useCallback(
    (command: ConnectCommand, queueRevision?: number): Promise<void> => {
      const target = latest.current.selectedId;
      const epoch = selectionEpoch.current;
      if (!target) return Promise.reject(new Error("No playback device selected."));
      setPending((value) => value + 1);
      const coalesce =
        command.type === "seek" || command.type === "setVolume"
          ? `${epoch}:${target}:${command.type}`
          : undefined;
      const task = commandQueue
        .enqueue(
          command,
          async (command) => {
            if (epoch !== selectionEpoch.current || latest.current.selectedId !== target)
              throw new Error(t("connect.changed"));
            if (
              !latest.current.connected ||
              !currentSnapshot.current.devices.some((device) => device.id === target)
            )
              throw new Error(t("connect.offline"));
            const next = await api.connectCommand(
              crypto.randomUUID(),
              target,
              command,
              queueRevision,
            );
            if (epoch === selectionEpoch.current) receive(next);
          },
          coalesce,
        )
        .catch((reason) => {
          notifyError(reason);
          throw reason;
        })
        .finally(() => setPending((value) => value - 1));
      return task;
    },
    [commandQueue, notifyError, receive, t],
  );

  const select = useCallback(
    async (device: string | null) => {
      const target = device === own.current ? null : device;
      if (target === latest.current.selectedId) return;
      selectionEpoch.current += 1;
      const value = latest.current;
      const visible =
        value.selectedId && value.remote
          ? {
              state: remoteState(value.remote.active, value.remote.tracks),
              position: positionAt(
                value.remote.active,
                value.remote.receivedAt,
                performance.now(),
                value.remote.tracks[value.remote.active.index]?.durationSeconds ?? 0,
                value.connected,
              ),
            }
          : { state: value.local, position: value.localProgress.getPosition() };
      const active = currentSnapshot.current.playback;
      const transfer: ConnectCommand = {
        type: "play",
        trackIds: visible.state.queue.map((track) => track.id),
        index: Math.max(0, visible.state.currentIndex),
        positionSeconds: visible.position,
        playing: visible.state.isPlaying,
        shuffle: visible.state.shuffle,
        repeat: visible.state.repeat,
        order: visible.state.queueOrder,
        radio: visible.state.radioSession,
      };
      if (!target) {
        wantsLocal.current = true;
        flushSync(() => {
          setSelectedId(null);
          setLease(true);
          value.output(true);
        });
        if (transfer.trackIds.length) value.load(visible.state.queue, transfer);
        return;
      }
      if (!currentSnapshot.current.devices.some((device) => device.id === target)) {
        notify(t("connect.offline"), "error");
        return;
      }
      wantsLocal.current = false;
      flushSync(() => {
        value.localActions.pause();
        value.output(false);
        setLease(false);
        setSelectedId(target);
      });
      if (active?.deviceId === target) receive(currentSnapshot.current);
      else if (transfer.trackIds.length) {
        setRemote({
          active: {
            ...playbackState(visible.state, {
              ...value.localProgress,
              getPosition: () => visible.position,
            }),
            deviceId: target,
            queueRevision: 0,
            reportedAt: new Date().toISOString(),
          },
          tracks: visible.state.queue,
          receivedAt: performance.now(),
        });
        await send(transfer);
      }
    },
    [notify, receive, send, t],
  );

  const continueHere = useCallback(async () => {
    try {
      await select(null);
      return true;
    } catch (reason) {
      notifyError(reason);
      return false;
    }
  }, [select, notifyError]);

  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setInterval(() => tick(performance.now()), 250);
    return () => clearInterval(timer);
  }, [selectedId]);

  const displayed = selectedId && remote ? remoteState(remote.active, remote.tracks) : local;
  const getRemotePosition = useCallback(
    () =>
      remote
        ? positionAt(
            remote.active,
            remote.receivedAt,
            performance.now(),
            remote.tracks[remote.active.index]?.durationSeconds ?? 0,
            available,
          )
        : 0,
    [remote, available],
  );
  const progress = selectedId
    ? {
        position: remote
          ? positionAt(
              remote.active,
              remote.receivedAt,
              Math.max(now, remote.receivedAt),
              displayed.currentTrack?.durationSeconds ?? 0,
              available,
            )
          : 0,
        duration: displayed.currentTrack?.durationSeconds ?? 0,
        buffered: 0,
        getPosition: getRemotePosition,
      }
    : localProgress;
  const patchRemote = useCallback(
    (id: string, changes: Partial<Track>) => {
      localActions.patchTrack(id, changes);
      setRemote((previous) =>
        previous
          ? {
              ...previous,
              tracks: previous.tracks.map((track) =>
                track.id === id ? { ...track, ...changes } : track,
              ),
            }
          : previous,
      );
    },
    [localActions],
  );
  // The adapter captures event callbacks without invoking them during render.
  const actions = selectedId
    ? remoteActions(
        displayed,
        progress,
        remote?.active.queueRevision ?? 0,
        // The factory only captures these event handlers; it does not call them.
        // eslint-disable-next-line react-hooks/refs
        send,
        // eslint-disable-next-line react-hooks/refs
        continueHere,
        patchRemote,
      )
    : localActions;
  const controls = useMemo<ConnectControls>(
    () => ({
      devices: snapshot.devices,
      selectedId,
      selectedName: selectedId
        ? snapshot.devices.find((device) => device.id === selectedId)?.name ||
          selectedName ||
          t("player.anotherDevice")
        : t("connect.thisDevice"),
      connected,
      available,
      pending: pending > 0,
      select,
    }),
    [snapshot.devices, selectedId, selectedName, t, connected, available, pending, select],
  );
  return {
    state: displayed,
    actions,
    progress,
    controls,
    shouldHold: !selectedId && (local.isPlaying || lease),
    report,
    claimed: () => setLease(true),
    displaced: () => {
      setLease(false);
      wantsLocal.current = false;
    },
  };
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { uploadFiles } from "@/lib/upload/upload";
import { ACCEPTED_EXTENSIONS, isAcceptedAudio } from "@/lib/playback/audioFormats";
import {
  checkAgainstLibrary,
  fileKey,
  findInLibrary,
  isDuplicate,
  type FileCheck,
} from "@/lib/upload/uploadCheck";
import { useFormat } from "@/lib/useFormat";
import { useInvalidate } from "@/lib/useInvalidate";
import { useRequiredContext } from "@/lib/useRequiredContext";
import { readStoredJson, writeStored, writeStoredJson } from "@/lib/storage";
import type { Track, UploadProgress, UploadResult } from "@/lib/types";
import { useSettings } from "@/lib/useSettings";
import { useT } from "./I18nContext";
import { useToast } from "@/lib/useToast";

type UploadFailure = UploadResult["failed"][number];

interface UploadState {
  queue: File[];

  checks: Record<string, FileCheck>;

  pending: File[];

  duplicates: File[];

  progress: UploadProgress | null;

  checking: number;

  uploaded: Track[];

  failed: UploadFailure[];

  add: (files: FileList | File[] | null) => void;
  remove: (index: number) => void;
  clearQueue: () => void;
  start: () => void;
  clearUploaded: () => void;
  clearFailed: () => void;
}

const UploadContext = createContext<UploadState | null>(null);

const RESULTS_STORAGE_KEY = "music-streaming.upload-results";

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const { maxUploadBytes } = useSettings();
  const { notify, notifyError } = useToast();
  const invalidate = useInvalidate();
  const format = useFormat();
  const t = useT();

  const [queue, setQueue] = useState<File[]>([]);
  const [checks, setChecks] = useState<Record<string, FileCheck>>({});
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [checking, setChecking] = useState(0);
  const [uploaded, setUploaded] = useState<Track[]>([]);
  const [failed, setFailed] = useState<UploadFailure[]>([]);
  const [restored, setRestored] = useState(false);

  const latest = useRef({ queue, checks });
  useEffect(() => {
    latest.current = { queue, checks };
  });

  const running = useRef(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const saved = readResults();

    if (saved.uploaded.length > 0) setUploaded(saved.uploaded);
    if (saved.failed.length > 0) setFailed(saved.failed);
    setRestored(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!restored) return;

    writeResults({ uploaded, failed });
  }, [restored, uploaded, failed]);

  const uploading = progress !== null;

  useEffect(() => {
    if (!uploading) return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();

    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  const check = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      setChecking((count) => count + 1);
      try {
        const checked = await checkAgainstLibrary(files);
        setChecks((current) => ({ ...current, ...checked }));

        const unchecked = Object.values(checked).filter((one) => one.state === "failed").length;
        if (unchecked > 0) notify(t("upload.checkFailed", { count: unchecked }), "error");
      } finally {
        setChecking((count) => count - 1);
      }
    },
    [notify, t],
  );

  const add = useCallback(
    (incoming: FileList | File[] | null) => {
      if (!incoming) return;

      const accepted: File[] = [];
      const rejected: UploadFailure[] = [];

      for (const file of Array.from(incoming)) {
        if (!isAcceptedAudio(file.name)) {
          rejected.push({
            fileName: file.name,
            reason: t("upload.unsupportedFormat", { formats: ACCEPTED_EXTENSIONS.join(", ") }),
          });
        } else if (file.size > maxUploadBytes) {
          rejected.push({
            fileName: file.name,
            reason: t("upload.tooLarge", { limit: format.bytes(maxUploadBytes) }),
          });
        } else {
          accepted.push(file);
        }
      }

      const queued = new Set(latest.current.queue.map(fileKey));
      const added = accepted.filter((file) => !queued.has(fileKey(file)));

      if (added.length > 0) {
        const known = latest.current.checks;

        setQueue((current) => [...current, ...added]);
        void check(added.filter((file) => known[fileKey(file)]?.state !== "checked"));
      }

      if (rejected.length > 0) {
        setFailed((current) => [...current, ...rejected]);
        notify(
          rejected.length === 1
            ? `${rejected[0].fileName}: ${rejected[0].reason}`
            : t("upload.rejected", { count: rejected.length }),
          "error",
        );
      }
    },
    [maxUploadBytes, check, notify, t, format],
  );

  const remove = useCallback((index: number) => {
    setQueue((current) => current.filter((_, at) => at !== index));
  }, []);

  const clearQueue = useCallback(() => setQueue([]), []);

  const clearUploaded = useCallback(() => setUploaded([]), []);

  const clearFailed = useCallback(() => setFailed([]), []);

  const start = useCallback(() => {
    if (running.current) return;

    const { queue: current, checks: known } = latest.current;

    const alreadyHave = (file: File) => isDuplicate(known[fileKey(file)]);
    const pending = current.filter((file) => !alreadyHave(file));

    if (pending.length === 0) return;

    const skipped = current.filter(alreadyHave).map((file) => ({
      fileName: file.name,
      reason: t("upload.alreadyInLibrary"),
    }));

    const taken = new Set(current.map(fileKey));

    running.current = true;

    setProgress({ percent: 0, fileIndex: 0, fileCount: pending.length, fileName: pending[0].name });
    setFailed(skipped);

    void (async () => {
      try {
        const result = await uploadFiles(
          pending,
          setProgress,
          (one) => {
            if (one.uploaded.length > 0) setUploaded((shown) => [...one.uploaded, ...shown]);
            if (one.failed.length > 0) setFailed((shown) => [...shown, ...one.failed]);
          },
          findInLibrary,
        );

        setQueue((later) => later.filter((file) => !taken.has(fileKey(file))));
        setChecks((later) =>
          Object.fromEntries(Object.entries(later).filter(([key]) => !taken.has(key))),
        );

        if (result.uploaded.length > 0) {
          notify(t("upload.added", { count: result.uploaded.length }), "success");
          invalidate("library");
        }

        if (result.failed.length > 0) {
          notify(t("upload.rejected", { count: result.failed.length }), "error");
        }
      } catch (reason) {
        notifyError(reason, t("upload.failed"));
      } finally {
        running.current = false;
        setProgress(null);
      }
    })();
  }, [invalidate, notify, notifyError, t]);

  const value = useMemo<UploadState>(() => {
    const alreadyHave = (file: File) => isDuplicate(checks[fileKey(file)]);

    return {
      queue,
      checks,
      pending: queue.filter((file) => !alreadyHave(file)),
      duplicates: queue.filter(alreadyHave),
      progress,
      checking,
      uploaded,
      failed,
      add,
      remove,
      clearQueue,
      start,
      clearUploaded,
      clearFailed,
    };
  }, [
    queue,
    checks,
    progress,
    checking,
    uploaded,
    failed,
    add,
    remove,
    clearQueue,
    start,
    clearUploaded,
    clearFailed,
  ]);

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUpload(): UploadState {
  return useRequiredContext(UploadContext, "useUpload", "UploadProvider");
}

interface PersistedResults {
  uploaded: Track[];
  failed: UploadFailure[];
}

const NOTHING: PersistedResults = { uploaded: [], failed: [] };

function readResults(): PersistedResults {
  const stored = readStoredJson(RESULTS_STORAGE_KEY, "session");
  if (stored === null || typeof stored !== "object") return NOTHING;

  const parsed = stored as Partial<PersistedResults>;

  return {
    uploaded: Array.isArray(parsed.uploaded) ? parsed.uploaded : [],
    failed: Array.isArray(parsed.failed) ? parsed.failed : [],
  };
}

function writeResults(results: PersistedResults) {
  if (results.uploaded.length === 0 && results.failed.length === 0) {
    writeStored(RESULTS_STORAGE_KEY, null, "session");
    return;
  }

  writeStoredJson(RESULTS_STORAGE_KEY, results, "session");
}

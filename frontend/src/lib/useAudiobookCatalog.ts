// SPDX-License-Identifier: AGPL-3.0-only

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  audiobookApi,
  audiobookClockOffset,
  isJournalKey,
  mergeJournalEntry,
  persistProgressEntry,
  readProgressJournal,
  sameAudiobookProgress,
  settleProgress,
  withLatestProgress,
  type Audiobook,
  type AudiobookProgress,
  type ProgressEntry,
  type ProgressJournal,
} from "./audiobooks";
import {
  readAudiobookCatalog,
  readDownloadedAudiobooks,
  refreshDownloadedArtwork,
  storeAudiobookCatalog,
} from "./audiobookDownloads";
import { ApiError } from "./http";
import { readStored, writeStored } from "./storage";

export function useAudiobookCatalog(scope: string | null, online: boolean, enabled: boolean) {
  const client = useQueryClient();
  const key = useMemo(() => ["audiobooks", scope], [scope]);
  const downloadKey = useMemo(() => ["audiobook-downloads", scope], [scope]);
  const journal = useRef<ProgressJournal>({});
  const confirmed = useRef(new Map<string, AudiobookProgress>());
  const inFlight = useRef(new Set<string>());
  const scopeRequest = useRef<AbortController | null>(null);
  const clockKey = `caimack-audiobook-clock:${scope}`;
  const clockOffset = useRef<number | null>(null);

  const observeServerTime = useCallback(
    (sentAt: number) => (headers: Headers) => {
      const offset = audiobookClockOffset(headers, sentAt, Date.now());
      if (offset === null || offset === clockOffset.current) return;
      clockOffset.current = offset;
      writeStored(clockKey, String(offset));
    },
    [clockKey],
  );

  const readJournal = useCallback(() => {
    if (scope) {
      for (const [id, stored] of Object.entries(readProgressJournal(scope))) {
        const entry = mergeJournalEntry(journal.current[id], stored);
        journal.current[id] = entry;
      }
    }
    return journal.current;
  }, [scope]);

  const remember = useCallback((id: string, progress: AudiobookProgress) => {
    const known = confirmed.current.get(id);
    if (known && known.updatedAtMs > progress.updatedAtMs) return known;
    confirmed.current.set(id, progress);
    return progress;
  }, []);

  const applyProgress = (book: Audiobook, journal: ProgressJournal, fromServer: boolean) => {
    if (fromServer && book.progress) remember(book.id, book.progress);
    const authoritative = withLatestProgress(book, confirmed.current.get(book.id));
    const local = journal[book.id];
    if (
      local?.settled &&
      authoritative.progress &&
      sameAudiobookProgress(authoritative.progress, local.settled) &&
      authoritative.chapters.some(({ id }) => id === local.progress.chapterId)
    ) {
      return { ...book, progress: local.progress };
    }
    return withLatestProgress(authoritative, local?.progress);
  };

  const result = useQuery({
    queryKey: key,
    enabled: enabled && scope !== null,
    staleTime: 0,
    refetchInterval: online ? 20_000 : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always",
    networkMode: "always",
    meta: { handlesError: true },
    queryFn: async ({ signal }) => {
      if (!scope) return [];

      let books: Audiobook[] | undefined;
      let fromServer = false;
      if (online) {
        try {
          books = await audiobookApi.catalog(signal, observeServerTime(Date.now()));
          fromServer = true;
        } catch (error) {
          if (signal.aborted || (error instanceof ApiError && error.status < 500)) throw error;
          books = await readAudiobookCatalog(scope).catch(() => undefined);
          if (!books) {
            books = await readDownloadedAudiobooks(scope).catch(() => []);
            if (!books.length) throw error;
          }
        }
      } else {
        books = await readAudiobookCatalog(scope).catch(() => undefined);
      }

      const saved = readJournal();
      const reconciled = (books ?? []).map((book) => applyProgress(book, saved, fromServer));
      if (fromServer) void storeAudiobookCatalog(scope, reconciled).catch(() => {});
      return reconciled;
    },
  });

  const downloads = useQuery({
    queryKey: downloadKey,
    enabled: enabled && scope !== null,
    staleTime: Infinity,
    networkMode: "always",
    meta: { handlesError: true },
    queryFn: async () => {
      if (!scope) return [];
      const books = await readDownloadedAudiobooks(scope);
      const saved = readJournal();
      return books.map((book) => applyProgress(book, saved, false));
    },
  });

  useEffect(() => {
    if (!scope || !online || !enabled || !result.data || !downloads.data?.length) return;
    const saved = new Set(downloads.data.map((book) => book.id));
    const controller = new AbortController();
    void refreshDownloadedArtwork(
      scope,
      result.data.filter((book) => saved.has(book.id)),
      controller.signal,
    ).catch(() => {});
    return () => controller.abort();
  }, [scope, online, enabled, result.data, downloads.data]);

  const books = useMemo(() => {
    const available = new Map(downloads.data?.map((book) => [book.id, book]));
    for (const book of result.data ?? []) available.set(book.id, book);
    return [...available.values()];
  }, [result.data, downloads.data]);

  const updateBook = useCallback(
    (id: string, update: (book: Audiobook) => Audiobook) => {
      const apply = (items: Audiobook[] | undefined) =>
        items?.map((book) => (book.id === id ? update(book) : book));
      client.setQueryData<Audiobook[]>(key, apply);
      client.setQueryData<Audiobook[]>(downloadKey, apply);
    },
    [client, key, downloadKey],
  );

  const saveEntry = useCallback(
    (bookId: string, entry: ProgressEntry) => {
      if (!scope) return;
      journal.current[bookId] = entry;
      persistProgressEntry(scope, bookId, entry);
    },
    [scope],
  );

  const flush = useCallback(async () => {
    const signal = scopeRequest.current?.signal;
    if (!enabled || !scope || !online || !navigator.onLine || !signal || signal.aborted) return;
    const entries = Object.entries(readJournal());
    await Promise.all(
      entries.map(async ([id, initial]) => {
        if (!initial.pending || inFlight.current.has(id)) return;

        inFlight.current.add(id);
        try {
          let value = initial;
          while (value.pending && navigator.onLine && !signal.aborted) {
            let winner: AudiobookProgress;
            try {
              winner = await audiobookApi.writeProgress(
                id,
                value.progress,
                signal,
                observeServerTime(Date.now()),
              );
            } catch (error) {
              if (error instanceof ApiError && [400, 404, 410, 422].includes(error.status)) {
                const latest = readJournal()[id];
                if (latest && sameAudiobookProgress(latest.progress, value.progress)) {
                  saveEntry(id, { ...value, pending: false });
                }
              }
              break;
            }
            const latest = readJournal()[id];
            const next = settleProgress(latest, value.progress, remember(id, winner));
            if (next !== latest) saveEntry(id, next);
            updateBook(id, (book) => ({ ...book, progress: next.progress }));
            value = next;
          }
        } finally {
          inFlight.current.delete(id);
        }
      }),
    );
  }, [enabled, scope, online, readJournal, updateBook, remember, saveEntry, observeServerTime]);

  const checkpoint = useCallback(
    (
      bookId: string,
      position: Omit<AudiobookProgress, "updatedAtMs">,
      lastKnown: AudiobookProgress | null,
      activation = false,
    ) => {
      if (!scope) return;
      const latest = readJournal();
      const saved = latest[bookId]?.progress;
      let previous = (saved?.updatedAtMs ?? 0) > (lastKnown?.updatedAtMs ?? 0) ? saved : lastKnown;
      const server = confirmed.current.get(bookId);
      if (server && server.updatedAtMs >= (previous?.updatedAtMs ?? 0)) previous = server;
      if (
        !activation &&
        previous?.chapterId === position.chapterId &&
        previous.positionMs === position.positionMs &&
        previous.completed === position.completed
      ) {
        void flush();
        return previous;
      }

      const offset = clockOffset.current ?? (Number(readStored(clockKey)) || 0);
      let accountFloor = 0;
      if (activation) {
        for (const { progress } of Object.values(latest)) {
          accountFloor = Math.max(accountFloor, progress.updatedAtMs);
        }
        for (const progress of confirmed.current.values()) {
          accountFloor = Math.max(accountFloor, progress.updatedAtMs);
        }
      }
      const progress = {
        ...position,
        updatedAtMs: Math.max(
          Date.now() + offset,
          (previous?.updatedAtMs ?? 0) + 1,
          accountFloor + 1,
        ),
      };
      saveEntry(bookId, { progress, pending: true });
      updateBook(bookId, (book) => ({ ...book, progress }));
      void flush();
      return progress;
    },
    [scope, readJournal, updateBook, flush, saveEntry, clockKey],
  );

  const { refetch } = result;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    scopeRequest.current = controller;
    return () => controller.abort();
  }, [enabled, scope]);

  useEffect(() => {
    if (!enabled || !scope) return;
    let active = true;
    const onlineAgain = () => {
      void flush().finally(() => {
        if (active) void refetch();
      });
    };
    const onStorage = (event: StorageEvent) => {
      if (!isJournalKey(scope, event.key)) return;
      for (const [id, { progress, settled }] of Object.entries(readJournal())) {
        updateBook(id, (book) =>
          settled && book.progress && sameAudiobookProgress(book.progress, settled)
            ? { ...book, progress }
            : withLatestProgress(book, progress),
        );
      }
    };

    const timer = window.setInterval(() => void flush(), 5_000);
    window.addEventListener("online", onlineAgain);
    window.addEventListener("caimack:refetch", onlineAgain);
    window.addEventListener("storage", onStorage);
    onlineAgain();

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("online", onlineAgain);
      window.removeEventListener("caimack:refetch", onlineAgain);
      window.removeEventListener("storage", onStorage);
    };
  }, [enabled, scope, flush, refetch, readJournal, updateBook]);

  const savedChange = async (book: Audiobook) => {
    const saved = !book.saved;
    await audiobookApi.save(book.id, saved);
    const savedAtMs = saved ? Date.now() : null;
    updateBook(book.id, (current) => ({ ...current, saved, savedAtMs }));
    if (scope) {
      const catalog = await readAudiobookCatalog(scope).catch(() => undefined);
      if (catalog) {
        await storeAudiobookCatalog(
          scope,
          catalog.map((item) => (item.id === book.id ? { ...item, saved, savedAtMs } : item)),
        ).catch(() => {});
      }
    }
  };

  const latestForPlayback = async (book: Audiobook) => {
    const known = books.find((item) => item.id === book.id) ?? book;
    const latest = (item: Audiobook, fromServer = false) =>
      applyProgress(item, readJournal(), fromServer);
    if (!online) return latest(known);

    try {
      const remote = await audiobookApi.detail(
        book.id,
        AbortSignal.timeout(1_200),
        observeServerTime(Date.now()),
      );
      const current = latest(remote, true);
      updateBook(book.id, () => current);
      return current;
    } catch {
      return latest(known);
    }
  };

  return { result, books, downloads, checkpoint, savedChange, latestForPlayback };
}

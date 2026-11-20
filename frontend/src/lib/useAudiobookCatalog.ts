// SPDX-License-Identifier: AGPL-3.0-only

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  audiobookApi,
  journalKey,
  persistProgressJournal,
  readProgressJournal,
  withLatestProgress,
  type Audiobook,
  type AudiobookProgress,
  type ProgressJournal,
} from "./audiobooks";
import {
  readAudiobookCatalog,
  readDownloadedAudiobooks,
  storeAudiobookCatalog,
} from "./audiobookDownloads";
import { ApiError } from "./http";

export function useAudiobookCatalog(scope: string | null, online: boolean) {
  const client = useQueryClient();
  const key = useMemo(() => ["audiobooks", scope], [scope]);
  const downloadKey = useMemo(() => ["audiobook-downloads", scope], [scope]);
  const journal = useRef<ProgressJournal>({});
  const inFlight = useRef(new Set<string>());

  const readJournal = useCallback(() => {
    if (scope) {
      for (const [id, progress] of Object.entries(readProgressJournal(scope))) {
        if (
          !journal.current[id] ||
          progress.progress.updatedAtMs >= journal.current[id].progress.updatedAtMs
        ) {
          journal.current[id] = progress;
        }
      }
    }
    return journal.current;
  }, [scope]);

  const result = useQuery({
    queryKey: key,
    enabled: scope !== null,
    staleTime: 0,
    refetchInterval: online ? 20_000 : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always",
    networkMode: "always",
    meta: { handlesError: true },
    queryFn: async ({ signal }) => {
      if (!scope) return [];

      let books: Audiobook[] | undefined;
      if (online) {
        try {
          books = await audiobookApi.catalog(signal);
          void storeAudiobookCatalog(scope, books).catch(() => {});
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
      return (books ?? []).map((book) => withLatestProgress(book, saved[book.id]?.progress));
    },
  });

  const downloads = useQuery({
    queryKey: downloadKey,
    enabled: scope !== null,
    staleTime: Infinity,
    networkMode: "always",
    meta: { handlesError: true },
    queryFn: async () => {
      if (!scope) return [];
      const books = await readDownloadedAudiobooks(scope);
      const saved = readJournal();
      return books.map((book) => withLatestProgress(book, saved[book.id]?.progress));
    },
  });

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

  const flush = useCallback(async () => {
    if (!scope || !online || !navigator.onLine) return;
    const entries = Object.entries(readJournal());
    await Promise.all(
      entries.map(async ([id, value]) => {
        if (!value.pending || inFlight.current.has(id)) return;

        inFlight.current.add(id);
        try {
          const progress = await audiobookApi.writeProgress(id, value.progress);
          const latest = readJournal();
          if (latest[id]?.progress.updatedAtMs !== value.progress.updatedAtMs) return;

          latest[id] = { progress, pending: false };
          persistProgressJournal(scope, latest);
          updateBook(id, (book) => ({ ...book, progress }));
        } catch (error) {
          if (error instanceof ApiError && [400, 404, 410, 422].includes(error.status)) {
            const latest = readJournal();
            if (latest[id]?.progress.updatedAtMs !== value.progress.updatedAtMs) return;
            latest[id] = { ...value, pending: false };
            persistProgressJournal(scope, latest);
          }
        } finally {
          inFlight.current.delete(id);
        }
      }),
    );
  }, [scope, online, readJournal, updateBook]);

  const checkpoint = useCallback(
    (
      bookId: string,
      position: Omit<AudiobookProgress, "updatedAtMs">,
      lastKnown: AudiobookProgress | null,
    ) => {
      if (!scope) return;
      const latest = readJournal();
      const saved = latest[bookId]?.progress;
      const previous =
        (saved?.updatedAtMs ?? 0) > (lastKnown?.updatedAtMs ?? 0) ? saved : lastKnown;
      if (
        previous?.chapterId === position.chapterId &&
        previous.positionMs === position.positionMs &&
        previous.completed === position.completed
      ) {
        void flush();
        return previous;
      }

      const progress = {
        ...position,
        updatedAtMs: Math.max(Date.now(), (previous?.updatedAtMs ?? 0) + 1),
      };
      latest[bookId] = { progress, pending: true };
      persistProgressJournal(scope, latest);
      updateBook(bookId, (book) => ({ ...book, progress }));
      void flush();
      return progress;
    },
    [scope, readJournal, updateBook, flush],
  );

  const { refetch } = result;
  useEffect(() => {
    if (!scope) return;
    const onlineAgain = () => {
      void flush().finally(() => void refetch());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== journalKey(scope)) return;
      for (const [id, { progress }] of Object.entries(readJournal())) {
        updateBook(id, (book) => withLatestProgress(book, progress));
      }
    };

    const timer = window.setInterval(() => void flush(), 5_000);
    window.addEventListener("online", onlineAgain);
    window.addEventListener("caimack:refetch", onlineAgain);
    window.addEventListener("storage", onStorage);
    onlineAgain();

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onlineAgain);
      window.removeEventListener("caimack:refetch", onlineAgain);
      window.removeEventListener("storage", onStorage);
    };
  }, [scope, flush, refetch, readJournal, updateBook]);

  const savedChange = async (book: Audiobook) => {
    const saved = !book.saved;
    await audiobookApi.save(book.id, saved);
    updateBook(book.id, (current) => ({ ...current, saved }));
    if (scope) {
      const catalog = await readAudiobookCatalog(scope).catch(() => undefined);
      if (catalog) {
        await storeAudiobookCatalog(
          scope,
          catalog.map((item) => (item.id === book.id ? { ...item, saved } : item)),
        ).catch(() => {});
      }
    }
  };

  const latestForPlayback = async (book: Audiobook) => {
    const known = books.find((item) => item.id === book.id) ?? book;
    const latest = (item: Audiobook) => withLatestProgress(item, readJournal()[item.id]?.progress);
    if (!online) return latest(known);

    try {
      const remote = await audiobookApi.detail(book.id, AbortSignal.timeout(1_200));
      const current = latest(remote);
      updateBook(book.id, () => current);
      return current;
    } catch {
      return latest(known);
    }
  };

  return { result, books, downloads, checkpoint, savedChange, latestForPlayback };
}

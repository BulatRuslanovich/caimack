// SPDX-License-Identifier: AGPL-3.0-only

import type { Audiobook } from "./audiobooks";
import { fetchWithSession } from "./http";

export const AUDIOBOOK_CACHE = "caimack-audiobooks-v1";

const prefix = (userId: string) => `/__caimack/audiobooks/${encodeURIComponent(userId)}/`;
const bookPrefix = (userId: string, id: string) => `${prefix(userId)}${encodeURIComponent(id)}/`;
const catalogKey = (userId: string) => `${prefix(userId)}catalog`;
export const downloadedChapterUrl = (userId: string, id: string, chapterId: string) =>
  `${bookPrefix(userId, id)}audio/${encodeURIComponent(chapterId)}`;
const coverKey = (userId: string, id: string) => `${bookPrefix(userId, id)}cover`;

function getCache(): Promise<Cache> {
  return caches.open(AUDIOBOOK_CACHE);
}

export async function storeAudiobookCatalog(userId: string, books: Audiobook[]) {
  const cache = await getCache();
  await cache.put(catalogKey(userId), Response.json(books));
}

export async function readAudiobookCatalog(userId: string): Promise<Audiobook[] | undefined> {
  const cache = await getCache();
  const response = await cache.match(catalogKey(userId));
  return response?.json();
}

export async function readDownloadedAudiobooks(userId: string): Promise<Audiobook[]> {
  if (typeof caches === "undefined") return [];

  const cache = await getCache();
  const base = prefix(userId);
  const markers = (await cache.keys()).filter(({ url }) => {
    const path = new URL(url).pathname;
    return path.startsWith(base) && path.endsWith("/book");
  });
  const entries = await Promise.all(
    markers.map(async (key) => {
      const response = await cache.match(key);
      return response ? ((await response.json()) as Audiobook) : null;
    }),
  );
  return entries.filter((book) => book !== null);
}

export async function downloadedAudio(userId: string, bookId: string, chapterId: string) {
  const cache = await getCache();
  const response = await cache.match(downloadedChapterUrl(userId, bookId, chapterId));
  return response?.blob();
}

export async function downloadedArtwork(userId: string, bookId: string) {
  const cache = await getCache();
  const response = await cache.match(coverKey(userId, bookId));
  return response?.blob();
}

export async function refreshDownloadedArtwork(
  userId: string,
  books: Audiobook[],
  signal: AbortSignal,
) {
  if (typeof caches === "undefined") return;
  const cache = await getCache();
  for (const book of books) {
    signal.throwIfAborted();
    const key = coverKey(userId, book.id);
    if (!book.coverUrl) {
      await cache.delete(key);
      continue;
    }
    const cached = await cache.match(key);
    if (cached?.url === new URL(book.coverUrl, location.href).href) continue;
    try {
      const cover = await fetchWithSession(book.coverUrl, { signal });
      if (cover.ok && (await cache.match(bookPrefix(userId, book.id) + "book"))) {
        signal.throwIfAborted();
        await cache.put(key, cover);
      }
    } catch (error) {
      if (signal.aborted) throw error;
      // Keep the last downloaded cover until the server has a replacement.
    }
  }
}

export async function removeDownloadedAudiobook(userId: string, bookId: string) {
  const cache = await getCache();
  const base = bookPrefix(userId, bookId);
  // Remove the completion marker before removing any audio.
  await cache.delete(`${base}book`);
  const files = (await cache.keys()).filter(({ url }) => new URL(url).pathname.startsWith(base));
  await Promise.all(files.map((key) => cache.delete(key)));
}

export async function downloadAudiobook(
  userId: string,
  book: Audiobook,
  signal: AbortSignal,
  onProgress: (percent: number) => void,
) {
  const cache = await getCache();
  const total = book.chapters.reduce((bytes, chapter) => bytes + chapter.sizeBytes, 0);
  let received = 0;

  try {
    for (const chapter of book.chapters) {
      const response = await fetchWithSession(chapter.streamUrl, { signal, cache: "no-store" });
      if (response.status !== 200 || !response.body) throw new Error();
      const body = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            received += chunk.byteLength;
            if (total > 0) onProgress(Math.min(99, Math.round((received / total) * 100)));
            controller.enqueue(chunk);
          },
        }),
      );
      await cache.put(
        downloadedChapterUrl(userId, book.id, chapter.id),
        new Response(body, {
          headers: {
            "Content-Type": response.headers.get("Content-Type") ?? "application/octet-stream",
          },
        }),
      );
    }

    if (book.coverUrl) {
      const cover = await fetchWithSession(book.coverUrl, { signal }).catch(() => null);
      if (cover?.ok) await cache.put(coverKey(userId, book.id), cover);
    }

    signal.throwIfAborted();
    await cache.put(`${bookPrefix(userId, book.id)}book`, Response.json(book));
  } catch (error) {
    await removeDownloadedAudiobook(userId, book.id).catch(() => {});
    throw error;
  }
}

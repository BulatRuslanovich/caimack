// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  audiobookClockOffset,
  audiobookTarget,
  journalKey,
  mergeJournalEntry,
  pausedAudiobookTarget,
  persistProgressEntry,
  readProgressJournal,
  settleProgress,
  type Audiobook,
  type AudiobookProgress,
} from "./audiobooks";

import { refreshDownloadedArtwork } from "./audiobookDownloads";

const chapters = ["1_1", "1_2", "1_3"].map((id) => ({
  id,
  title: id,
  durationMs: 40_000,
  sizeBytes: 20_000,
  streamUrl: `/api/audiobooks/book/chapters/${id}/stream`,
}));

const book: Audiobook = {
  id: "book",
  title: "Audiobook",
  author: null,
  narrator: null,
  coverUrl: null,
  chapters,
  durationMs: 120_000,
  saved: false,
  progress: null,
};

const at = (chapterId: string, positionMs: number, updatedAtMs: number): AudiobookProgress => ({
  chapterId,
  positionMs,
  updatedAtMs,
  completed: false,
});

describe("downloaded audiobook covers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves the offline copy on failure and fetches only a changed cover on reconnect", async () => {
    const scope = "listener";
    const key = "/__caimack/audiobooks/listener/book/cover";
    const origin = "https://caimack.test";
    const coverUrl = "/api/audiobooks/book/cover?v=2";
    const response = (body: string, url: string) =>
      Object.defineProperty(new Response(body), "url", { value: url });
    const entries = new Map([
      [key, response("old", origin + "/api/audiobooks/book/cover?v=1")],
      ["/__caimack/audiobooks/listener/book/book", Response.json(book)],
    ]);
    vi.stubGlobal("location", new URL(origin));
    vi.stubGlobal("caches", {
      open: async () => ({
        match: async (path: string) => entries.get(path),
        put: async (path: string, value: Response) => entries.set(path, value),
        delete: async (path: string) => entries.delete(path),
      }),
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(response("new", origin + coverUrl));
    vi.stubGlobal("fetch", fetch);
    const refresh = () =>
      refreshDownloadedArtwork(scope, [{ ...book, coverUrl }], new AbortController().signal);
    await refresh();
    expect(await entries.get(key)?.clone().text()).toBe("old");
    await refresh();
    expect(await entries.get(key)?.clone().text()).toBe("new");
    await refresh();
    expect(fetch.mock.calls.map(([path]) => path)).toEqual([coverUrl, coverUrl]);
  });
});

describe("audiobook playback target", () => {
  const updated = { ...book, progress: at("1_3", 16_000, 2000) };

  it("plays the chapter explicitly selected from a stale detail page", () => {
    expect(audiobookTarget(updated, "1_1")).toEqual({
      chapter: chapters[0],
      index: 0,
      positionMs: 0,
    });
    expect(audiobookTarget(updated, "removed")).toBeNull();
  });

  it("resumes the server chapter and position when continuing or selecting that same chapter", () => {
    const target = { chapter: chapters[2], index: 2, positionMs: 16_000 };
    expect(audiobookTarget(updated)).toEqual(target);
    expect(audiobookTarget(updated, "1_3")).toEqual(target);
    expect(pausedAudiobookTarget(updated)).toEqual(target);
  });

  it("shows the final chapter for a paused finished book and starts over on play", () => {
    const completed = { ...book, progress: { ...at("1_3", 40_000, 2000), completed: true } };
    expect(pausedAudiobookTarget(completed)).toEqual({
      chapter: chapters[2],
      index: 2,
      positionMs: 40_000,
    });
    expect(audiobookTarget(completed)?.chapter.id).toBe("1_1");
  });
});

describe("audiobook progress journal", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a newer pause pending when the in-flight checkpoint completes", () => {
    const inFlight = at("1_1", 10_000, 1000);
    const pause = { progress: at("1_1", 11_000, 1100), pending: true };
    expect(settleProgress(pause, inFlight, inFlight)).toBe(pause);
  });

  it("acknowledges the winning server checkpoint across tabs after timestamp clamping", () => {
    const submitted = at("1_2", 0, 5000);
    const winner = at("1_3", 16_000, 4000);
    const pending = { progress: submitted, pending: true };
    const acknowledged = settleProgress(pending, submitted, winner);
    expect(acknowledged).toEqual({ progress: winner, pending: false, settled: submitted });
    expect(mergeJournalEntry(pending, acknowledged)).toBe(acknowledged);
    expect(mergeJournalEntry(acknowledged, pending)).toBe(acknowledged);
  });

  it("keeps separate pending books and reads progress created before the storage change", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      get length() {
        return storage.size;
      },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });

    const legacy = { progress: at("1_1", 5000, 1000), pending: true };
    storage.set(journalKey("account"), JSON.stringify({ first: legacy }));
    const next = { progress: at("1_2", 1000, 1100), pending: true };
    const other = { progress: at("1_3", 2000, 1200), pending: true };
    persistProgressEntry("account", "first", next);
    persistProgressEntry("account", "second", other);
    persistProgressEntry("other-account", "first", legacy);
    expect(readProgressJournal("account")).toEqual({ first: next, second: other });
    expect(readProgressJournal("other-account")).toEqual({ first: legacy });
  });

  it("calibrates new events against the server without using slow or unsupported samples", () => {
    const headers = new Headers({ "X-Caimack-Server-Time-Ms": "3050" });
    expect(audiobookClockOffset(headers, 1000, 1100)).toBe(2000);
    expect(audiobookClockOffset(headers, 1000, 3500)).toBeNull();
    expect(audiobookClockOffset(new Headers(), 1000, 1100)).toBeNull();
  });
});

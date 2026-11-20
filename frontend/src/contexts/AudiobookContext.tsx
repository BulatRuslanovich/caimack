// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useT } from "@/contexts/I18nContext";
import { useDesktopStatus } from "@/desktop/api";
import {
  downloadAudiobook,
  downloadedAudio,
  downloadedChapterUrl,
  removeDownloadedAudiobook,
} from "@/lib/audiobookDownloads";
import {
  audiobookHref,
  type Audiobook,
  type AudiobookProgress,
  withLatestProgress,
} from "@/lib/audiobooks";
import { cacheAudiobookShell } from "@/lib/serviceWorker";
import { useAudiobookCatalog } from "@/lib/useAudiobookCatalog";
import { useRequiredContext } from "@/lib/useRequiredContext";
import { useToast } from "@/lib/useToast";
import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

interface PlayingBook {
  book: Audiobook;
  chapterIndex: number;
  progress: AudiobookProgress | null;
}

interface AudiobookPlayer {
  active: PlayingBook | null;
  playing: boolean;
  pending: boolean;
  speed: number;
  play: (book: Audiobook, chapterIndex?: number) => void;
  toggle: () => void;
  seek: (ms: number) => void;
  skip: (ms: number) => void;
  setSpeed: (speed: number) => void;
  close: () => void;
}

interface AudiobookState {
  player: AudiobookPlayer;
  clock: ReturnType<typeof createClock>;
  scope: string | null;
  online: boolean;
  books: Audiobook[];
  result: ReturnType<typeof useAudiobookCatalog>["result"];
  downloaded: ReadonlySet<string>;
  transfer: { bookId: string; percent: number } | null;
  download: (book: Audiobook) => void;
  removeDownload: (book: Audiobook) => void;
  cancelDownload: () => void;
  save: (book: Audiobook) => Promise<void>;
}

const AudiobookContext = createContext<AudiobookState | null>(null);

export function useAudiobooks() {
  return useRequiredContext(AudiobookContext, "useAudiobooks", "AudiobookProvider");
}

const initialClock = { positionMs: 0, durationMs: 0 };

function createClock() {
  let value = initialClock;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(update: Partial<typeof initialClock>) {
      const next = { ...value, ...update };
      if (next.positionMs === value.positionMs && next.durationMs === value.durationMs) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
  };
}

export function useAudiobookClock() {
  const { clock } = useAudiobooks();
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, () => initialClock);
}

function subscribeToNetwork(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

interface AudiobookProviderProps {
  userId: string | null;
  musicPlaying: boolean;
  pauseMusic: () => void;
  onActiveChange: (active: boolean) => void;
  volume: number;
  muted: boolean;
  children: ReactNode;
}

export function AudiobookProvider(props: AudiobookProviderProps) {
  const desktop = useDesktopStatus();
  const id = props.userId;
  const scope = id && (desktop?.server ? `${desktop.server}\n${id}` : id);
  return (
    <AudiobookSession key={scope} {...props} scope={scope} serverOnline={desktop?.online ?? true} />
  );
}

function AudiobookSession({
  scope,
  serverOnline,
  musicPlaying,
  pauseMusic,
  onActiveChange,
  volume,
  muted,
  children,
}: AudiobookProviderProps & { scope: string | null; serverOnline: boolean }) {
  const networkOnline = useSyncExternalStore(
    subscribeToNetwork,
    () => navigator.onLine,
    () => true,
  );
  const online = networkOnline && serverOnline;

  const catalog = useAudiobookCatalog(scope, online);
  const downloaded = new Set(catalog.downloads.data?.map((book) => book.id));
  const { notify } = useToast();
  const t = useT();

  const [active, setActive] = useState<PlayingBook | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pending, setPending] = useState(false);
  const [clock] = useState(createClock);
  const [speed, setPlaybackSpeed] = useState(1);
  const [transfer, setTransfer] = useState<AudiobookState["transfer"]>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const current = useRef<PlayingBook | null>(null);
  const objectUrl = useRef<string | null>(null);
  const loadId = useRef(0);
  const selectionId = useRef(0);
  const waitingForGesture = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const storeProgress = useRef(catalog.checkpoint);
  const abortDownload = () => controller.current?.abort();

  useEffect(() => {
    storeProgress.current = catalog.checkpoint;
  }, [catalog.checkpoint]);

  const checkpoint = useCallback(() => {
    const session = current.current;
    const audio = audioRef.current;
    const chapter = session?.book.chapters[session.chapterIndex];
    if (!session || !audio || !chapter || !audio.readyState || audio.ended) return;
    const ms = Math.round(audio.currentTime * 1000);
    if (ms === 0 && !session.progress) return;
    if (session.progress?.chapterId === chapter.id && session.progress.positionMs === ms) return;
    session.progress =
      storeProgress.current(
        session.book.id,
        { chapterId: chapter.id, positionMs: ms, completed: false },
        session.progress,
      ) ?? session.progress;
  }, []);

  const unload = useCallback(() => {
    const audio = audioRef.current;
    waitingForGesture.current = false;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);

  const close = useCallback(() => {
    checkpoint();
    selectionId.current++;
    loadId.current++;
    current.current = null;
    unload();
    setActive(null);
    setPlaying(false);
    setPending(false);
    onActiveChange(false);
  }, [checkpoint, onActiveChange, unload]);

  useEffect(() => {
    if (!musicPlaying) return;
    if (current.current) close();
    else selectionId.current++;
  }, [musicPlaying, close]);

  useEffect(() => {
    const recordOnBackground = () => {
      if (document.visibilityState === "hidden") checkpoint();
    };
    const timer = window.setInterval(() => {
      if (!audioRef.current?.paused) checkpoint();
    }, 4_000);
    window.addEventListener("pagehide", checkpoint);
    document.addEventListener("visibilitychange", recordOnBackground);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", checkpoint);
      document.removeEventListener("visibilitychange", recordOnBackground);
    };
  }, [checkpoint]);

  useEffect(
    () => () => {
      loadId.current++;
      selectionId.current++;
      controller.current?.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      if (current.current) onActiveChange(false);
    },
    [onActiveChange],
  );

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
    audioRef.current.muted = muted;
  }, [volume, muted]);

  const start = async (book: Audiobook, chapterIndex?: number) => {
    const audio = audioRef.current;
    if (!audio || !scope) return;
    if (!online && !downloaded.has(book.id)) {
      notify(t("audiobooks.offlineUnavailable"), "info");
      return;
    }

    const activeBook = current.current;
    if (activeBook?.book.id === book.id && chapterIndex === undefined) {
      if (!audio.paused) {
        audio.pause();
        return;
      }
      book = withLatestProgress(book, activeBook.progress ?? undefined);
      if (
        !book.progress?.completed &&
        (book.progress?.updatedAtMs ?? 0) <= (activeBook.progress?.updatedAtMs ?? 0) &&
        audio.src &&
        !audio.error
      ) {
        pauseMusic();
        await audio.play().catch(reportPlayError);
        return;
      }
    }

    checkpoint();
    if (activeBook?.book.id === book.id) {
      book = withLatestProgress(book, activeBook.progress ?? undefined);
    }

    const previous = chapterIndex === undefined && !book.progress?.completed ? book.progress : null;
    const index =
      chapterIndex ??
      Math.max(
        0,
        book.chapters.findIndex((item) => item.id === previous?.chapterId),
      );
    const chapter = book.chapters[index];
    if (!chapter) return;

    const request = ++loadId.current;
    current.current = null;
    unload();
    pauseMusic();
    const next = { book, chapterIndex: index, progress: book.progress };
    current.current = next;
    setActive(next);
    onActiveChange(true);
    setPlaying(false);
    setPending(true);
    const position = previous?.chapterId === chapter.id ? previous.positionMs : 0;
    clock.update({ positionMs: position, durationMs: chapter.durationMs });

    try {
      let src = chapter.streamUrl;
      if (downloaded.has(book.id)) {
        if (navigator.serviceWorker?.controller?.scriptURL.includes("/sw.js")) {
          src = downloadedChapterUrl(scope, book.id, chapter.id);
        } else {
          const blob = await downloadedAudio(scope, book.id, chapter.id);
          if (request !== loadId.current) return;
          if (blob) src = objectUrl.current = URL.createObjectURL(blob);
        }
      }

      audio.src = src;
      audio.playbackRate = speed;
      audio.currentTime = position / 1000;
      await audio.play();
    } catch (error) {
      if (request !== loadId.current) return;
      reportPlayError(error);
    } finally {
      if (request === loadId.current) setPending(false);
    }
  };

  const reportPlayError = (error: unknown) => {
    if (error instanceof DOMException) {
      if (error.name === "AbortError") return;
      if (error.name === "NotAllowedError") {
        waitingForGesture.current = true;
        notify(t("audiobooks.playBlocked"), "info");
        return;
      }
    }
    notify(t("audiobooks.playFailed"), "error");
  };

  const seek = (ms: number) => {
    const audio = audioRef.current;
    if (!audio || !audio.readyState || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, ms / 1000));
    clock.update({ positionMs: Math.round(audio.currentTime * 1000) });
    checkpoint();
  };

  const skip = (ms: number) => seek((audioRef.current?.currentTime ?? 0) * 1000 + ms);

  const onEnded = () => {
    const session = current.current;
    if (!session) return;

    const next = session.chapterIndex + 1;
    const completed = next >= session.book.chapters.length;
    const chapter = session.book.chapters[completed ? session.chapterIndex : next];
    session.progress =
      catalog.checkpoint(
        session.book.id,
        { chapterId: chapter.id, positionMs: completed ? chapter.durationMs : 0, completed },
        session.progress,
      ) ?? session.progress;
    setPlaying(false);
    if (!completed) void start(session.book, next);
  };

  const play = (book: Audiobook, chapterIndex?: number) => {
    const selection = ++selectionId.current;
    const audio = audioRef.current;
    const sameBook = current.current?.book.id === book.id;
    if (chapterIndex === undefined && sameBook && audio?.src && waitingForGesture.current) {
      waitingForGesture.current = false;
      pauseMusic();
      void audio.play().catch(reportPlayError);
      return;
    }
    if (chapterIndex !== undefined || (sameBook && audio?.paused === false)) {
      void start(book, chapterIndex);
      return;
    }
    void catalog.latestForPlayback(book).then((latest) => {
      if (selection === selectionId.current) void start(latest);
    });
  };

  const toggle = () => {
    if (!current.current) return;
    play(current.current.book);
  };

  const setSpeed = (next: number) => {
    if (audioRef.current) audioRef.current.playbackRate = next;
    setPlaybackSpeed(next);
  };

  const download = async (book: Audiobook) => {
    if (!scope || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setTransfer({ bookId: book.id, percent: 0 });
    let displayedPercent = 0;
    try {
      const shell = Promise.all([
        cacheAudiobookShell("/audiobooks"),
        cacheAudiobookShell(audiobookHref(book.id)),
      ]);
      await downloadAudiobook(scope, book, abort.signal, (percent) => {
        if (percent === displayedPercent) return;
        displayedPercent = percent;
        setTransfer({ bookId: book.id, percent });
      });
      await shell;
      await catalog.downloads.refetch();
      notify(t("audiobooks.downloadedLabel"), "success");
    } catch {
      if (!abort.signal.aborted) notify(t("audiobooks.downloadFailed"), "error");
    } finally {
      controller.current = null;
      setTransfer(null);
    }
  };

  const removeDownload = async (book: Audiobook) => {
    if (!scope) return;
    if (current.current?.book.id === book.id) close();
    try {
      await removeDownloadedAudiobook(scope, book.id);
      await catalog.downloads.refetch();
    } catch {
      notify(t("audiobooks.removeFailed"), "error");
    }
  };

  const save = async (book: Audiobook) => {
    try {
      await catalog.savedChange(book);
    } catch {
      notify(t("collection.failed"), "error");
    }
  };

  return (
    <AudiobookContext.Provider
      value={{
        player: {
          active,
          playing,
          pending,
          speed,
          play,
          toggle,
          seek,
          skip,
          setSpeed,
          close,
        },
        clock,
        scope,
        online,
        books: catalog.books,
        result: catalog.result,
        downloaded,
        transfer,
        download,
        removeDownload,
        cancelDownload: abortDownload,
        save,
      }}
    >
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const duration = event.currentTarget.duration;
          if (Number.isFinite(duration)) clock.update({ durationMs: Math.round(duration * 1000) });
        }}
        onTimeUpdate={(event) =>
          clock.update({ positionMs: Math.round(event.currentTarget.currentTime * 1000) })
        }
        onPlaying={() => {
          setPlaying(true);
          setPending(false);
        }}
        onPause={() => {
          setPlaying(false);
          checkpoint();
        }}
        onEnded={onEnded}
      />
    </AudiobookContext.Provider>
  );
}

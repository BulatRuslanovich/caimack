// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { deviceId } from "@/lib/events";
import { api } from "@/lib/api";
import { useConnect } from "@/lib/playback/useConnectPlayback";
import type { AudiobookHandoff } from "@/lib/playback/connect";
import { useT } from "@/contexts/I18nContext";
import { useDesktopStatus } from "@/desktop/api";
import { useAudiobookExperiment } from "@/lib/audiobookExperiment";
import {
  downloadAudiobook,
  downloadedAudio,
  downloadedChapterUrl,
  removeDownloadedAudiobook,
} from "@/lib/audiobookDownloads";
import {
  audiobookApi,
  audiobookCatalogHref,
  audiobookHref,
  audiobookTarget,
  pausedAudiobookTarget,
  sameAudiobookProgress,
  type Audiobook,
  type AudiobookProgress,
} from "@/lib/audiobooks";
import { cacheAudiobookShell } from "@/lib/serviceWorker";
import { useAudiobookCatalog } from "@/lib/useAudiobookCatalog";
import { useRequiredContext } from "@/lib/useRequiredContext";
import { useToast } from "@/lib/useToast";
import {
  createContext,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

interface PlayingBook {
  book: Audiobook;
  chapterIndex: number;
  progress: AudiobookProgress | null;
  publishStart: boolean;
}

interface AudiobookPlayer {
  active: PlayingBook | null;
  playing: boolean;
  pending: boolean;
  speed: number;
  play: (book: Audiobook, chapterId?: string) => void;
  toggle: () => void;
  seek: (ms: number) => void;
  skip: (ms: number) => void;
  changeChapter: (delta: number) => void;
  setSpeed: (speed: number) => void;
  volume: number;
  muted: boolean;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  close: () => void;
  transferTo: (id: string | null) => Promise<void>;
}

interface AudiobookState {
  enabled: boolean;
  experimentReady: boolean;
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
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  children: ReactNode;
}

export function AudiobookProvider(props: AudiobookProviderProps) {
  const desktop = useDesktopStatus();
  const id = props.userId;
  const scope = id && (desktop?.server ? `${desktop.server}\n${id}` : id);
  const experiment = useAudiobookExperiment(scope);
  return (
    <AudiobookSession
      key={scope}
      {...props}
      enabled={experiment.enabled}
      experimentReady={experiment.ready}
      scope={scope}
      serverOnline={desktop?.online ?? true}
    />
  );
}

function AudiobookSession({
  scope,
  enabled,
  experimentReady,
  serverOnline,
  musicPlaying,
  pauseMusic,
  onActiveChange,
  volume,
  muted,
  setVolume,
  toggleMute,
  children,
}: AudiobookProviderProps & {
  scope: string | null;
  serverOnline: boolean;
  enabled: boolean;
  experimentReady: boolean;
}) {
  const networkOnline = useSyncExternalStore(
    subscribeToNetwork,
    () => navigator.onLine,
    () => true,
  );
  const online = networkOnline && serverOnline;

  const catalog = useAudiobookCatalog(scope, online, enabled);
  const downloaded = new Set(catalog.downloads.data?.map((book) => book.id));
  const { notify, notifyError } = useToast();
  const { audiobookReceiverRef, activeBook, devices, connected } = useConnect();
  const ownDevice = typeof window === "undefined" ? null : deviceId();
  const connectionId = devices.find((device) => device.id === ownDevice)?.connectionId;
  const bookOwner = devices.find((device) => device.id === activeBook?.deviceId);
  const [remoteClock] = useState(createClock);
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
  const selecting = useRef(false);
  const waitingForGesture = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const storeProgress = useRef(catalog.checkpoint);
  const bookReports = useRef(Promise.resolve());
  const lastBookReport = useRef<{ key: string; connection: string; selection: number } | null>(
    null,
  );
  const reportLocal = useCallback(() => {
    if (!connected || !connectionId || !ownDevice) return Promise.resolve();
    const send = async () => {
      const session = current.current;
      const audio = audioRef.current;
      if (session && (!audio?.readyState || selecting.current)) return;
      const value =
        session && audio
          ? {
              bookId: session.book.id,
              chapterId: session.book.chapters[session.chapterIndex].id,
              playing: !audio.paused && !audio.ended,
              positionMs: Math.round(audio.currentTime * 1000),
            }
          : null;
      const selection = loadId.current;
      const prior = lastBookReport.current;
      if (!value && !prior) return;
      const claim =
        !!value &&
        (!prior ||
          prior.selection !== selection ||
          (value.playing && prior.connection !== connectionId));
      const key = JSON.stringify(value);
      if (!claim && key === prior?.key && prior.connection === connectionId) return;
      await api.connectBookReport(ownDevice, connectionId, value, claim);
      lastBookReport.current = value ? { key, selection, connection: connectionId } : null;
    };
    const task = bookReports.current.then(send);
    bookReports.current = task.catch(() => {});
    return task;
  }, [connected, connectionId, ownDevice]);
  useEffect(() => {
    if (pending) return;
    void reportLocal().catch(() => {});
    if (!active) return;
    const timer = window.setInterval(() => void reportLocal().catch(() => {}), 1000);
    return () => window.clearInterval(timer);
  }, [active, playing, pending, reportLocal]);
  const abortDownload = () => controller.current?.abort();

  useEffect(() => {
    storeProgress.current = catalog.checkpoint;
  }, [catalog.checkpoint]);

  const checkpoint = useCallback((activation = false, positionMs?: number) => {
    const session = current.current;
    const audio = audioRef.current;
    const chapter = session?.book.chapters[session.chapterIndex];
    if (!session || !audio || !chapter) return;
    if (positionMs === undefined && (!audio.readyState || audio.ended)) return;

    const position = positionMs ?? Math.round(audio.currentTime * 1000);
    if (
      !activation &&
      session.progress?.chapterId === chapter.id &&
      session.progress.positionMs === position &&
      !session.progress.completed
    ) {
      return;
    }
    if (!activation && positionMs === undefined && position === 0 && !session.progress) return;

    session.progress =
      storeProgress.current(
        session.book.id,
        { chapterId: chapter.id, positionMs: position, completed: false },
        session.progress,
        activation,
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
    if (!audioRef.current?.paused) checkpoint();
    selectionId.current++;
    selecting.current = false;
    loadId.current++;
    current.current = null;
    unload();
    setActive(null);
    setPlaying(false);
    setPending(false);
    onActiveChange(false);
  }, [checkpoint, onActiveChange, unload]);

  useEffect(() => {
    if (!enabled) controller.current?.abort();
    if (enabled && !musicPlaying) return;
    if (current.current || selecting.current) close();
  }, [enabled, musicPlaying, close]);

  useEffect(() => {
    const recordOnBackground = () => {
      if (document.visibilityState === "hidden" && !audioRef.current?.paused) checkpoint();
    };
    const timer = window.setInterval(() => {
      if (!audioRef.current?.paused) checkpoint();
    }, 4_000);
    const recordOnExit = () => {
      if (!audioRef.current?.paused) checkpoint();
    };
    window.addEventListener("pagehide", recordOnExit);
    document.addEventListener("visibilitychange", recordOnBackground);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", recordOnExit);
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

  const start = async (
    book: Audiobook,
    chapterId?: string,
    restartChapter = false,
    handoff?: AudiobookHandoff,
    signal?: AbortSignal,
  ) => {
    const audio = audioRef.current;
    if (!audio || !scope) {
      setPending(false);
      return;
    }
    if (!online && !downloaded.has(book.id)) {
      setPending(false);
      notify(t("audiobooks.offlineUnavailable"), "info");
      return;
    }

    const session = current.current;
    const target = audiobookTarget(book, chapterId);
    if (!target) {
      setPending(false);
      return;
    }

    const { chapter, index } = target;
    const position = handoff
      ? Math.min(handoff.positionMs, chapter.durationMs)
      : restartChapter
        ? 0
        : target.positionMs;
    if (
      !handoff &&
      session?.book.id === book.id &&
      session.book.chapters[session.chapterIndex]?.id === chapter.id &&
      Math.abs(Math.round(audio.currentTime * 1000) - position) <= 100 &&
      audio.src &&
      !audio.error &&
      !audio.ended
    ) {
      session.progress = book.progress;
      session.publishStart = true;
      pauseMusic();
      try {
        await audio.play();
      } catch (error) {
        reportPlayError(error);
      } finally {
        if (current.current === session) setPending(false);
      }
      return;
    }

    const request = ++loadId.current;
    current.current = null;
    unload();
    pauseMusic();
    const next = { book, chapterIndex: index, progress: book.progress, publishStart: true };
    current.current = next;
    setActive(next);
    onActiveChange(true);
    setPlaying(false);
    setPending(true);
    clock.update({ positionMs: position, durationMs: chapter.durationMs });

    try {
      let src = chapter.streamUrl;
      if (downloaded.has(book.id)) {
        if (navigator.serviceWorker?.controller?.scriptURL.includes("/sw.js")) {
          src = downloadedChapterUrl(scope, book.id, chapter.id);
        } else {
          const blob = await downloadedAudio(scope, book.id, chapter.id);
          if (request !== loadId.current) {
            if (handoff) throw new Error(t("connect.changed"));
            return;
          }
          if (blob) src = objectUrl.current = URL.createObjectURL(blob);
        }
      }

      signal?.throwIfAborted();
      audio.src = src;
      audio.playbackRate = speed;
      audio.currentTime = position / 1000;
      if (handoff?.playing === false) {
        // A paused transfer is still acknowledged only after the destination opens the chapter.
        await new Promise<void>((resolve, reject) => {
          const events = new AbortController();
          const done = (error?: unknown) => {
            events.abort();
            signal?.removeEventListener("abort", interrupted);
            if (error) reject(error);
            else resolve();
          };
          const interrupted = () => done(new Error("Audiobook transfer interrupted."));
          signal?.addEventListener("abort", interrupted, { once: true });
          audio.addEventListener("loadedmetadata", () => done(), { signal: events.signal });
          audio.addEventListener("error", interrupted, { signal: events.signal });
        });
        if (request !== loadId.current) throw new Error(t("connect.changed"));
        checkpoint(true, position);
      } else {
        await audio.play();
      }
      signal?.throwIfAborted();
    } catch (error) {
      if (handoff) {
        if (request === loadId.current) close();
        throw error;
      }
      if (request !== loadId.current) return;
      reportPlayError(error);
    } finally {
      if (request === loadId.current) setPending(false);
    }
  };

  const receiveBook = async (command: AudiobookHandoff, signal: AbortSignal) => {
    if (!enabled || !scope || !online) throw new Error(t("audiobooks.offlineUnavailable"));
    if (command.keepPosition) {
      const session = current.current;
      const audio = audioRef.current;
      if (
        !session ||
        !audio ||
        session.book.id !== command.bookId ||
        session.book.chapters[session.chapterIndex]?.id !== command.chapterId
      )
        throw new Error(t("connect.changed"));
      if (command.playing) await audio.play();
      else audio.pause();
      await reportLocal();
      return;
    }
    const book = await audiobookApi.detail(command.bookId, signal);
    signal.throwIfAborted();
    if (!book.chapters.some((chapter) => chapter.id === command.chapterId))
      throw new Error(t("audiobooks.playFailed"));
    selectionId.current++;
    selecting.current = false;
    const request = loadId.current + 1;
    const cancel = () => {
      if (loadId.current === request) close();
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      await start(book, command.chapterId, false, command, signal);
      await reportLocal();
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  };
  const receiveEvent = useEffectEvent(receiveBook);
  useEffect(() => {
    audiobookReceiverRef.current = receiveEvent;
    return () => {
      audiobookReceiverRef.current = null;
    };
  }, [audiobookReceiverRef]);

  const remote = enabled && !active ? activeBook : null;
  const remoteBook = remote && catalog.books.find((book) => book.id === remote.bookId);
  const remoteIndex = remoteBook
    ? remoteBook.chapters.findIndex((chapter) => chapter.id === remote?.chapterId)
    : -1;
  const remoteChapter = remoteIndex >= 0 && remoteBook ? remoteBook.chapters[remoteIndex] : null;
  const remoteTarget =
    remote && connected && bookOwner && bookOwner.id !== ownDevice ? bookOwner.id : null;
  const remotePlaying = !!(remoteTarget && remote?.playing);
  const reportedAt = remote?.reportedAt,
    position = remote?.positionMs;
  useEffect(() => {
    if (!remoteChapter || position === undefined) return;
    const since = performance.now();
    const update = () =>
      remoteClock.update({
        durationMs: remoteChapter.durationMs,
        positionMs: Math.min(
          remoteChapter.durationMs,
          position + (remotePlaying ? performance.now() - since : 0),
        ),
      });
    update();
    if (remotePlaying) {
      const timer = window.setInterval(update, 250);
      return () => clearInterval(timer);
    }
  }, [remoteChapter, remoteClock, remotePlaying, reportedAt, position]);

  const commandFor = (
    book: Audiobook,
    chapterId: string,
    positionMs: number,
    playing: boolean,
  ): AudiobookHandoff => ({
    type: "playAudiobook",
    bookId: book.id,
    chapterId,
    positionMs: Math.round(positionMs),
    playing,
  });
  const remoteAction = async (command: AudiobookHandoff, device = remoteTarget) => {
    if (device) await api.connectCommand(crypto.randomUUID(), device, command);
    else if (online) await receiveBook(command, AbortSignal.timeout(12_000));
    else if (remoteBook) await start(remoteBook, command.chapterId, false, command);
  };
  const transferTo = async (device: string | null) => {
    if (remote && remoteBook && remoteChapter) {
      if (device === remoteTarget) return;
      try {
        await remoteAction(
          commandFor(
            remoteBook,
            remoteChapter.id,
            remoteClock.getSnapshot().positionMs,
            remotePlaying,
          ),
          device,
        );
      } catch (error) {
        notifyError(error);
        throw error;
      }
      return;
    }
    if (!device) return;
    const session = current.current;
    const audio = audioRef.current;
    if (!session || !audio || pending) throw new Error(t("audiobooks.playFailed"));
    const playing = !audio.paused;
    const selection = selectionId.current;
    const positionMs = audio.readyState
      ? Math.round(audio.currentTime * 1000)
      : clock.getSnapshot().positionMs;
    audio.pause();
    try {
      await api.connectCommand(crypto.randomUUID(), device, {
        type: "playAudiobook",
        bookId: session.book.id,
        chapterId: session.book.chapters[session.chapterIndex].id,
        playing,
        positionMs,
      });
      if (selection === selectionId.current && current.current?.book.id === session.book.id)
        close();
    } catch (error) {
      if (playing && selection === selectionId.current && audio.src)
        await audio.play().catch(reportPlayError);
      notifyError(error);
      throw error;
    }
  };

  const previousOwner = useRef<string | null>(null);
  useEffect(() => {
    if (
      previousOwner.current === ownDevice &&
      ownDevice &&
      connected &&
      activeBook?.deviceId !== ownDevice &&
      current.current
    )
      close();
    previousOwner.current = activeBook?.deviceId ?? null;
  }, [activeBook, ownDevice, connected, close]);

  const alignPaused = useCallback(
    (book: Audiobook) => {
      const audio = audioRef.current;
      const session = current.current;
      const progress = book.progress;
      if (
        !audio?.paused ||
        selecting.current ||
        waitingForGesture.current ||
        session?.book.id !== book.id ||
        !progress ||
        (session.progress && sameAudiobookProgress(session.progress, progress))
      ) {
        return;
      }

      const target = pausedAudiobookTarget(book);
      if (!target) return;
      const previousChapter = session.book.chapters[session.chapterIndex];
      const position = clock.getSnapshot().positionMs;
      if (
        previousChapter?.id !== target.chapter.id ||
        position !== target.positionMs ||
        progress.completed
      ) {
        loadId.current++;
        unload();
      }

      const next = { book, progress, chapterIndex: target.index, publishStart: false };
      current.current = next;
      setActive(next);
      clock.update({ positionMs: target.positionMs, durationMs: target.chapter.durationMs });
    },
    [clock, unload],
  );

  useEffect(() => {
    if (!active || playing || pending) return;
    const fresh = catalog.books.find(({ id }) => id === active.book.id);
    if (!fresh) return;
    let currentSnapshot = true;
    queueMicrotask(() => {
      if (currentSnapshot) alignPaused(fresh);
    });
    return () => {
      currentSnapshot = false;
    };
  }, [active, alignPaused, catalog.books, pending, playing]);

  const refreshPaused = useEffectEvent(() => {
    const session = current.current;
    if (!session || selecting.current || !audioRef.current?.paused) return;
    if (document.visibilityState === "visible") void catalog.latestForPlayback(session.book);
  });
  const activeBookId = active?.book.id;
  useEffect(() => {
    if (!activeBookId || playing || pending || !online) return;
    const timer = window.setInterval(() => refreshPaused(), 8_000);
    const onVisibility = () => refreshPaused();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activeBookId, online, pending, playing]);

  const seek = (ms: number) => {
    const audio = audioRef.current;
    const session = current.current;
    const durationMs = clock.getSnapshot().durationMs;
    if (!audio || !session || !durationMs || selecting.current) return;

    const positionMs = Math.round(Math.max(0, Math.min(durationMs, ms)));
    if (audio.readyState && Number.isFinite(audio.duration)) audio.currentTime = positionMs / 1000;
    clock.update({ positionMs });
    checkpoint(false, positionMs);
  };

  const skip = (ms: number) => seek(clock.getSnapshot().positionMs + ms);

  const onEnded = () => {
    const session = current.current;
    if (!session || !audioRef.current?.ended) return;

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
    if (!completed && !selecting.current) void start(session.book, chapter.id, true);
  };

  const play = (book: Audiobook, chapterId?: string) => {
    if (!enabled) return;
    const audio = audioRef.current;
    const session = current.current;
    const localChapter = session?.book.chapters[session.chapterIndex];
    const sameSelection =
      session?.book.id === book.id && (chapterId === undefined || chapterId === localChapter?.id);
    const selection = ++selectionId.current;

    if (sameSelection && audio && !audio.paused) {
      selecting.current = false;
      checkpoint();
      audio.pause();
      setPlaying(false);
      setPending(false);
      return;
    }
    if (sameSelection && audio?.src && waitingForGesture.current) {
      waitingForGesture.current = false;
      pauseMusic();
      void audio.play().catch(reportPlayError);
      return;
    }

    // Finish the outgoing chapter before asking the server for the new position.
    if (audio && !audio.paused) {
      checkpoint();
      audio.pause();
      setPlaying(false);
    }
    loadId.current++;
    selecting.current = true;
    setPending(true);
    void catalog.latestForPlayback(book).then((latest) => {
      if (selection !== selectionId.current) return;
      selecting.current = false;
      void start(latest, chapterId);
    });
  };

  const toggle = () => {
    if (!current.current) return;
    play(current.current.book);
  };

  const changeChapter = (delta: number) => {
    const session = current.current;
    if (!session) return;
    const chapter = session.book.chapters[session.chapterIndex + delta];
    if (!chapter) return;
    selectionId.current++;
    selecting.current = false;
    if (!audioRef.current?.paused) checkpoint();
    void start(session.book, chapter.id, true);
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
        cacheAudiobookShell(audiobookCatalogHref),
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

  const mirrored =
    remote && remoteBook && remoteChapter
      ? {
          book: remoteBook,
          chapterIndex: remoteIndex,
          progress: remoteBook.progress,
          publishStart: false,
        }
      : null;
  const controlRemote = (
    book: Audiobook,
    chapter: string,
    ms: number,
    run: boolean,
    keepPosition = false,
  ) =>
    void remoteAction({ ...commandFor(book, chapter, ms, run), keepPosition }).catch(notifyError);
  const displayedPlay = (book: Audiobook, chapterId?: string) => {
    if (!mirrored || !remote || (!remoteTarget && book.id !== remote.bookId))
      return play(book, chapterId);
    const same = book.id === mirrored.book.id && (!chapterId || chapterId === remote.chapterId);
    const target = audiobookTarget(book, chapterId);
    if (target)
      controlRemote(
        book,
        same ? remote.chapterId : target.chapter.id,
        same ? remoteClock.getSnapshot().positionMs : target.positionMs,
        same ? !remotePlaying : true,
        same && !!remoteTarget,
      );
  };
  const displayedSeek = (ms: number) => {
    if (mirrored && remote && remoteChapter)
      controlRemote(
        mirrored.book,
        remote.chapterId,
        Math.max(0, Math.min(ms, remoteChapter.durationMs)),
        remotePlaying,
      );
    else seek(ms);
  };
  const activeBookDetails = active && catalog.books.find((book) => book.id === active.book.id);
  const localView =
    active && activeBookDetails
      ? {
          ...active,
          book: {
            ...active.book,
            title: activeBookDetails.title,
            author: activeBookDetails.author,
            narrator: activeBookDetails.narrator,
            coverUrl: activeBookDetails.coverUrl,
          },
        }
      : active;

  return (
    <AudiobookContext.Provider
      value={{
        enabled,
        experimentReady,
        player: {
          active: enabled ? (localView ?? mirrored) : null,
          playing: enabled && (mirrored ? remotePlaying : playing),
          pending: enabled && pending,
          speed,
          play: displayedPlay,
          toggle: mirrored ? () => displayedPlay(mirrored.book) : toggle,
          seek: displayedSeek,
          skip: mirrored
            ? (delta) => displayedSeek(remoteClock.getSnapshot().positionMs + delta)
            : skip,
          changeChapter: mirrored
            ? (delta) => {
                const chapter = mirrored.book.chapters[remoteIndex + delta];
                if (chapter) controlRemote(mirrored.book, chapter.id, 0, remotePlaying);
              }
            : changeChapter,
          setSpeed,
          volume,
          muted,
          setVolume,
          toggleMute,
          transferTo,
          close,
        },
        clock: mirrored ? remoteClock : clock,
        scope,
        online,
        books: !enabled
          ? []
          : online
            ? catalog.books
            : catalog.books.filter((book) => downloaded.has(book.id)),
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
        onTimeUpdate={(event) => {
          if (event.currentTarget.readyState) {
            clock.update({ positionMs: Math.round(event.currentTarget.currentTime * 1000) });
          }
        }}
        onPlaying={(event) => {
          const session = current.current;
          if (!session || event.currentTarget.paused || selecting.current) return;
          setPlaying(true);
          setPending(false);
          if (session.publishStart) {
            session.publishStart = false;
            checkpoint(true);
          }
        }}
        onPause={(event) => {
          if (!event.currentTarget.paused) return;
          setPlaying(false);
          if (!current.current?.publishStart) checkpoint();
        }}
        onEnded={onEnded}
      />
    </AudiobookContext.Provider>
  );
}

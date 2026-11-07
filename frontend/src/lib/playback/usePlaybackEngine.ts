// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, SyntheticEvent } from "react";
import { api } from "@/lib/api";
import { AdaptivePlayback, warmUpHls } from "@/lib/playback/adaptivePlayback";
import { Crossfade } from "@/lib/playback/crossfade";
import { refreshSession } from "@/lib/http";
import {
  createListeningTracker,
  historyThresholdFor,
  type ListeningTracker,
} from "@/lib/playback/playbackTelemetry";
import { PlaybackRecovery } from "@/lib/playback/playbackRecovery";
import { normalizationGain } from "@/lib/playback/loudness";
import { planTransition, transitionStage } from "@/lib/playback/transitions";
import { registerStreamWorker } from "@/lib/serviceWorker";
import type { Track } from "@/lib/types";
import { useInvalidate } from "@/lib/useInvalidate";
import { useSettings } from "@/lib/useSettings";
import { useT } from "@/contexts/I18nContext";
import { useToast } from "@/lib/useToast";
import type {
  PendingSwitch,
  PlaybackEngine,
  PlaybackEngineInput,
  Standby,
} from "@/lib/playback/playbackEngineTypes";
import { bufferedAhead, silence, sourceKeyOf } from "@/lib/playback/audioSource";

const SWITCH_TIMER_WINDOW_SECONDS = 0.6;

let scriptableVolume: boolean | null = null;

export function usePlaybackEngine({
  currentTrack,
  nextTrack,
  crossfade,
  smartTransitions,
  normalizeVolume,
  repeat,
  isPlaying,
  setIsPlaying,
  volume,
  muted,
  onTrackEnded,
}: PlaybackEngineInput): PlaybackEngine {
  const { notify } = useToast();
  const t = useT();
  const settings = useSettings();
  const invalidate = useInvalidate();

  const primaryRef = useRef<HTMLAudioElement | null>(null);
  const secondaryRef = useRef<HTMLAudioElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const adaptiveRef = useRef<AdaptivePlayback | null>(null);

  const standbyRef = useRef<Standby | null>(null);
  const switchPendingRef = useRef<PendingSwitch | null>(null);
  const switchTimerRef = useRef<number | null>(null);
  const [crossfader] = useState(() => new Crossfade());

  const clearSwitchTimer = useCallback(() => {
    if (switchTimerRef.current === null) return;

    window.clearTimeout(switchTimerRef.current);
    switchTimerRef.current = null;
  }, []);

  useEffect(() => {
    audioRef.current ??= primaryRef.current;
  }, []);

  const spareAudio = useCallback(
    () => (audioRef.current === primaryRef.current ? secondaryRef.current : primaryRef.current),
    [],
  );

  const dropStandby = useCallback(() => {
    const standby = standbyRef.current;
    if (!standby) return;

    standbyRef.current = null;
    const audio = spareAudio();
    if (audio) silence(audio, standby.playback);
  }, [spareAudio]);

  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [sourceRevision, setSourceRevision] = useState(0);

  const recordedRef = useRef<string | null>(null);

  const trackerRef = useRef<ListeningTracker | null>(null);
  const tracker = (trackerRef.current ??= createListeningTracker());

  const pendingSeekRef = useRef<number | null>(null);
  const positionRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const waitingTimerRef = useRef<number | null>(null);
  const clearWaitingTimer = useCallback(() => {
    if (waitingTimerRef.current !== null) window.clearTimeout(waitingTimerRef.current);
    waitingTimerRef.current = null;
  }, []);

  const [recovery] = useState(() => new PlaybackRecovery());

  const failSource = useCallback(
    (resume: boolean): boolean => {
      const first = recovery.fail(audioRef.current?.dataset.trackId, resume);

      return first;
    },
    [recovery],
  );

  const recoverSource = useCallback((): boolean => {
    const resumed = recovery.recover();
    if (!resumed) return false;

    setSourceRevision((revision) => revision + 1);

    return resumed.resume;
  }, [recovery]);

  useEffect(() => {
    registerStreamWorker();

    const warm = () => warmUpHls();
    const idle = window.requestIdleCallback?.(warm, { timeout: 10_000 }) ?? null;
    window.addEventListener("pointerdown", warm, { once: true, passive: true });

    const wentOnline = () => {
      if (recoverSource()) setIsPlaying(true);
    };
    window.addEventListener("online", wentOnline);

    return () => {
      if (idle !== null) window.cancelIdleCallback?.(idle);
      window.removeEventListener("pointerdown", warm);
      window.removeEventListener("online", wentOnline);
    };
  }, [recoverSource, setIsPlaying]);

  const seek = useCallback(
    (seconds: number) => {
      const audio = audioRef.current;
      if (!audio) return;

      crossfader.finish();
      clearSwitchTimer();

      const clamped = Math.max(0, Math.min(seconds, audio.duration || seconds));
      tracker.reposition(clamped);
      audio.currentTime = clamped;
      setPosition(clamped);
      positionRef.current = clamped;
    },
    [crossfader, clearSwitchTimer, tracker],
  );

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const audio = audioRef.current;
      if (!audio) return;

      seek(audio.currentTime + deltaSeconds);
    },
    [seek],
  );

  const scrubRef = useRef<number | null>(null);
  const resumeAfterScrub = useRef({ muted, isPlaying });
  useLayoutEffect(() => {
    resumeAfterScrub.current = { muted, isPlaying };
  });

  const scrubBy = useCallback(
    (deltaSeconds: number) => {
      const audio = audioRef.current;
      if (!audio) return;

      crossfader.finish();

      const from = scrubRef.current ?? audio.currentTime;
      const target = Math.max(0, Math.min(from + deltaSeconds, audio.duration || from));
      scrubRef.current = target;
      audio.muted = true;
      setPosition(target);
      positionRef.current = target;
    },
    [crossfader],
  );

  const holdScrub = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    crossfader.finish();
    scrubRef.current ??= audio.currentTime;
    audio.pause();
  }, [crossfader]);

  const commitScrub = useCallback(() => {
    const target = scrubRef.current;
    if (target === null) return;

    scrubRef.current = null;
    const { muted, isPlaying } = resumeAfterScrub.current;
    const audio = audioRef.current;
    if (audio) audio.muted = muted;
    seek(target);
    if (audio && isPlaying && audio.paused) void audio.play().catch(() => {});
  }, [seek]);

  const startQueue = useCallback(() => {
    tracker.finish("trackSkipped");
    switchPendingRef.current = null;

    setPosition(0);
    pendingSeekRef.current = null;
  }, [tracker]);

  const resetProgress = useCallback(() => setPosition(0), []);

  const resumeAt = useCallback((trackId: string | undefined, seconds: number) => {
    if (trackId && audioRef.current?.dataset.trackId !== trackId) {
      pendingSeekRef.current = seconds;
    }

    setPosition(seconds);
    positionRef.current = seconds;
  }, []);

  const quality = settings.quality;

  useEffect(() => {
    recovery.reset();
  }, [recovery, quality]);

  useEffect(() => {
    const retryQuality = () => {
      recovery.reset();
      setSourceRevision((revision) => revision + 1);
    };
    window.addEventListener("retry-stream-quality", retryQuality);
    return () => window.removeEventListener("retry-stream-quality", retryQuality);
  }, [recovery]);

  const prepareNext = useCallback(
    (track: Track, startAt: number) => {
      if (crossfader.active) return;
      const playing = audioRef.current;
      if (playing && !playing.paused) {
        const ahead = bufferedAhead(playing);
        const remaining = playing.duration - playing.currentTime;
        // Prioritize the song being heard over speculative downloads on a weak link.
        if (ahead < 8 && (!Number.isFinite(remaining) || ahead < remaining - 0.5)) return;
      }

      const forceAdaptive = recovery.forceAdaptive(quality, track.id);
      const sourceKey = sourceKeyOf(track.id, quality, forceAdaptive, sourceRevision);
      if (standbyRef.current?.sourceKey === sourceKey) return;

      dropStandby();
      const audio = spareAudio();
      if (!audio) return;

      const playback = new AdaptivePlayback(audio, {
        onFatalError: () => {
          if (standbyRef.current === standby) dropStandby();
        },
      });
      const standby: Standby = { trackId: track.id, sourceKey, playback, ready: false };
      standbyRef.current = standby;

      audio.preload = "auto";
      audio.dataset.trackId = track.id;
      audio.dataset.sourceKey = sourceKey;
      crossfader.setGain(audio, normalizationGain(track, normalizeVolume));

      void playback
        .load({
          trackId: track.id,
          quality,
          forceAdaptive,
          startAt,
          play: false,
        })
        .then(() => {
          standby.ready = true;
        })
        .catch(() => {
          if (standbyRef.current === standby) dropStandby();
        });
    },
    [crossfader, recovery, quality, sourceRevision, normalizeVolume, dropStandby, spareAudio],
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    clearWaitingTimer();

    const fadeSeconds = switchPendingRef.current?.fade ?? 0;
    switchPendingRef.current = null;
    clearSwitchTimer();

    if (!currentTrack) {
      tracker.discard();
      crossfader.finish();
      dropStandby();
      silence(audio, adaptiveRef.current);
      adaptiveRef.current = null;
      return;
    }

    // Keep this track's delivery stable; recovery of Original happens between tracks.
    const forceAdaptive =
      recovery.forceAdaptive(quality, currentTrack.id) ||
      audio.dataset.sourceKey === sourceKeyOf(currentTrack.id, quality, true, sourceRevision);
    const sourceKey = sourceKeyOf(currentTrack.id, quality, forceAdaptive, sourceRevision);
    if (audio.dataset.sourceKey === sourceKey) return;

    recovery.clearFailure();

    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    const standby = standbyRef.current;
    const incoming = spareAudio();

    if (standby?.ready && standby.sourceKey === sourceKey && incoming && !incoming.error) {
      const outgoingPlayback = adaptiveRef.current;

      standbyRef.current = null;
      audioRef.current = incoming;
      adaptiveRef.current = standby.playback;

      recordedRef.current = null;
      tracker.finish("trackSkipped");
      tracker.begin(currentTrack);
      tracker.reposition(incoming.currentTime);

      pendingSeekRef.current = null;
      positionRef.current = incoming.currentTime;
      setDuration(
        Number.isFinite(incoming.duration) ? incoming.duration : currentTrack.durationSeconds,
      );
      const ranges = incoming.buffered;
      setBuffered(ranges.length > 0 ? ranges.end(ranges.length - 1) : 0);
      recovery.loaded(currentTrack.id);

      if (fadeSeconds > 0 && isPlaying) {
        crossfader.start(audio, incoming, fadeSeconds, () => silence(audio, outgoingPlayback));
      } else {
        silence(audio, outgoingPlayback);
        incoming.volume = crossfader.levelFor(incoming);
      }
      return;
    }

    crossfader.finish();
    dropStandby();

    const staysOnSameTrack = audio.dataset.trackId === currentTrack.id;

    if (staysOnSameTrack) {
      pendingSeekRef.current ??= audio.currentTime || positionRef.current;
    } else {
      recordedRef.current = null;

      tracker.finish("trackSkipped");
      tracker.begin(currentTrack);
    }

    const startAt = staysOnSameTrack
      ? (pendingSeekRef.current ?? (audio.currentTime || positionRef.current))
      : (pendingSeekRef.current ?? 0);
    tracker.reposition(startAt);
    pendingSeekRef.current = null;

    audio.dataset.trackId = currentTrack.id;
    audio.dataset.sourceKey = sourceKey;
    positionRef.current = startAt;
    setDuration(currentTrack.durationSeconds || 0);

    const reportLoadFailure = () => {
      if (adaptiveRef.current !== playback) return;
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      const wantsPlay = resumeAfterScrub.current.isPlaying;
      if (failSource(wantsPlay)) notify(t("player.offlineWaiting"), "info");
      setWaiting(true);
      if (!offline && wantsPlay && retryTimerRef.current === null) {
        retryTimerRef.current = window.setTimeout(() => {
          retryTimerRef.current = null;
          setSourceRevision((revision) => revision + 1);
        }, 10_000);
      }
    };

    adaptiveRef.current?.destroy();
    const playback = new AdaptivePlayback(audio, {
      onFatalError: () => reportLoadFailure(),
    });
    adaptiveRef.current = playback;

    void playback
      .load({
        trackId: currentTrack.id,
        quality,
        forceAdaptive,
        startAt,
        play: isPlaying,
      })
      .then(() => {
        if (adaptiveRef.current === playback) recovery.loaded(currentTrack.id);
      })
      .catch(() => {
        if (adaptiveRef.current === playback) reportLoadFailure();
      });
  }, [
    currentTrack,
    quality,
    sourceRevision,
    isPlaying,
    notify,
    t,
    tracker,
    recovery,
    failSource,
    crossfader,
    dropStandby,
    spareAudio,
    clearSwitchTimer,
    clearWaitingTimer,
  ]);

  useEffect(() => {
    const standby = standbyRef.current;
    if (standby && standby.trackId !== nextTrack?.id) dropStandby();
  }, [nextTrack, dropStandby]);

  useEffect(() => {
    const primary = primaryRef.current;
    const secondary = secondaryRef.current;
    return () => {
      primary?.pause();
      secondary?.pause();
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
      if (switchTimerRef.current !== null) window.clearTimeout(switchTimerRef.current);
      clearWaitingTimer();
      crossfader.finish();
      standbyRef.current?.playback.destroy();
      adaptiveRef.current?.destroy();
    };
  }, [crossfader, clearWaitingTimer]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    adaptiveRef.current?.setPlaying(isPlaying);
    recovery.setIntent(isPlaying);
    if (!isPlaying && retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (isPlaying && audio.dataset.sourceLoading !== "true") {
      crossfader.resume();
      audio
        .play()
        .catch((reason: unknown) => {
          const name = reason instanceof DOMException ? reason.name : "";
          if (name !== "AbortError") {
            setIsPlaying(false);

            if (name === "NotAllowedError") notify(t("player.autoplayBlocked"), "error");
          }
        })
        .catch(() => {});
    } else {
      audio.pause();
      crossfader.pause();
    }
  }, [isPlaying, currentTrack, notify, t, setIsPlaying, crossfader, recovery]);

  useEffect(() => {
    crossfader.setLevel(volume);

    for (const audio of [primaryRef.current, secondaryRef.current]) {
      if (audio) audio.muted = muted;
    }

    if (!crossfader.active && audioRef.current) {
      audioRef.current.volume = crossfader.levelFor(audioRef.current);
    }
  }, [volume, muted, crossfader]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    crossfader.setGain(audio, normalizationGain(currentTrack, normalizeVolume));
    if (!crossfader.active) audio.volume = crossfader.levelFor(audio);
  }, [currentTrack, normalizeVolume, crossfader]);

  const checkTransitionRef = useRef<() => void>(() => {});

  const checkTransition = useCallback(() => {
    const audio = audioRef.current;
    const track = currentTrack;
    if (!audio || !track || !nextTrack || switchPendingRef.current || crossfader.active) return;
    if (scrubRef.current !== null) return;

    scriptableVolume ??=
      Object.assign(document.createElement("audio"), { volume: 0.5 }).volume === 0.5;

    const at = audio.currentTime;
    const plan = planTransition({
      crossfade,
      smart: smartTransitions,
      canFade: scriptableVolume,
      repeat,
      current: track,
      currentDuration: Number.isFinite(audio.duration) ? audio.duration : track.durationSeconds,
      next: nextTrack,
    });

    const stage = transitionStage(at, plan);
    if (!plan || stage === "wait") return;

    prepareNext(nextTrack, plan.nextStartAt);

    if (stage === "preload") {
      const until = (plan.at - at) / (audio.playbackRate || 1);

      if (until < SWITCH_TIMER_WINDOW_SECONDS && switchTimerRef.current === null && !audio.paused) {
        switchTimerRef.current = window.setTimeout(() => {
          switchTimerRef.current = null;
          checkTransitionRef.current();
        }, until * 1000);
      }
      return;
    }

    const incoming = spareAudio();
    if (
      audio.paused ||
      !standbyRef.current?.ready ||
      !incoming ||
      incoming.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
    ) {
      return;
    }

    clearSwitchTimer();
    switchPendingRef.current = { from: audio, fade: plan.fade };

    if (plan.fade === 0) {
      incoming.volume = crossfader.levelFor(incoming);
      void incoming.play().catch(() => {});
    }

    tracker.finish("trackCompleted");
    onTrackEnded();
  }, [
    currentTrack,
    nextTrack,
    crossfade,
    smartTransitions,
    repeat,
    tracker,
    crossfader,
    prepareNext,
    spareAudio,
    clearSwitchTimer,
    onTrackEnded,
  ]);

  useEffect(() => {
    checkTransitionRef.current = checkTransition;
  }, [checkTransition]);

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const at = audio.currentTime;
    if (audio.paused || audio.seeking) tracker.reposition(at);
    else tracker.accumulate(at);
    crossfader.tick();
    if (!audio.paused && audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) setWaiting(false);
    if (scrubRef.current !== null) return;

    setPosition(at);
    positionRef.current = at;

    const track = currentTrack;
    if (!track) return;

    const listened = tracker.listenedSeconds();
    if (
      recordedRef.current !== track.id &&
      listened >= historyThresholdFor(track.durationSeconds)
    ) {
      recordedRef.current = track.id;

      void api
        .recordPlay(track.id, Math.floor(at), listened)
        .then(() => invalidate("history"))
        .catch(() => {});
    }

    checkTransitionRef.current();
  }, [currentTrack, tracker, invalidate, crossfader]);

  const handleProgress = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const ranges = audio.buffered;
    setBuffered(ranges.length > 0 ? ranges.end(ranges.length - 1) : 0);
  }, []);

  const handleEnded = useCallback(() => {
    if (switchPendingRef.current?.from === audioRef.current) return;

    tracker.finish("trackCompleted");

    if (repeat === "one") {
      seek(0);

      if (currentTrack) tracker.begin(currentTrack);

      void audioRef.current?.play().catch(() => setIsPlaying(false));
      return;
    }

    onTrackEnded();
  }, [onTrackEnded, repeat, tracker, currentTrack, seek, setIsPlaying]);

  const handleError = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (audio.dataset.playbackMode !== "progressive") return;

    const resumeAt = audio.currentTime > 0 ? audio.currentTime : positionRef.current;

    const decision = recovery.decide({
      trackId: currentTrack.id,
      errorCode: audio.error?.code,
      offline: typeof navigator !== "undefined" && !navigator.onLine,
    });

    if (decision.kind === "offline") {
      if (failSource(isPlaying)) notify(t("player.offlineWaiting"), "info");
      setWaiting(true);
      return;
    }

    if (
      decision.kind === "retry" &&
      decision.attempt > 0 &&
      audio.error?.code === 2 &&
      quality === "Original" &&
      !recovery.degraded
    ) {
      pendingSeekRef.current = resumeAt;
      recovery.degrade();
      notify(t("player.qualityReduced"), "info");
      setSourceRevision((revision) => revision + 1);
      return;
    }

    if (decision.kind === "giveUp") {
      if (audio.error?.code === 2 || audio.error?.code === undefined) {
        if (failSource(isPlaying)) notify(t("player.offlineWaiting"), "info");
        setWaiting(true);
        if (isPlaying)
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            setSourceRevision((revision) => revision + 1);
          }, 30_000);
        return;
      }
      recovery.recover();

      tracker.discard();
      if (isPlaying) {
        notify(t("player.skippedUnplayable", { title: currentTrack.title }), "info");
        onTrackEnded();
      }
      return;
    }

    if (decision.kind === "fallback") {
      notify(t("player.qualityFallback"), "info");
      pendingSeekRef.current = resumeAt;
      setSourceRevision((revision) => revision + 1);
      return;
    }

    const { attempt } = decision;

    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;

      const element = audioRef.current;
      if (!element || element.dataset.trackId !== currentTrack.id) return;

      const retry = () => {
        if (
          element.dataset.playbackMode !== "progressive" ||
          audioRef.current !== element ||
          element.dataset.trackId !== currentTrack.id ||
          !resumeAfterScrub.current.isPlaying
        )
          return;
        void adaptiveRef.current
          ?.load({
            trackId: currentTrack.id,
            quality,
            forceAdaptive: recovery.forceAdaptive(quality, currentTrack.id),
            startAt: resumeAt,
            play: true,
          })
          .catch(() => {
            if (failSource(true)) notify(t("player.offlineWaiting"), "info");
          });
      };

      if (attempt === 0) void refreshSession().then(retry);
      else retry();
    }, decision.delayMs);
  }, [currentTrack, isPlaying, quality, notify, t, recovery, failSource, onTrackEnded, tracker]);

  const handleWaiting = useCallback(() => {
    const audio = audioRef.current;

    if (
      !audio ||
      !currentTrack ||
      !isPlaying ||
      quality !== "Original" ||
      audio.dataset.playbackMode !== "progressive" ||
      recovery.forceAdaptive(quality, currentTrack.id) ||
      audio.seeking ||
      waitingTimerRef.current !== null
    ) {
      return;
    }

    if (bufferedAhead(audio) > 2) return;

    // A short wait or seek should not lower quality. Do not interrupt buffered playback.
    waitingTimerRef.current = window.setTimeout(() => {
      waitingTimerRef.current = null;
      if (
        audioRef.current !== audio ||
        !resumeAfterScrub.current.isPlaying ||
        (audio.paused && audio.dataset.sourceLoading !== "true") ||
        audio.seeking ||
        audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA ||
        !navigator.onLine
      )
        return;
      pendingSeekRef.current = audio.currentTime;
      recovery.degrade();
      notify(t("player.qualityReduced"), "info");
      setSourceRevision((revision) => revision + 1);
    }, 4000);
  }, [currentTrack, quality, recovery, isPlaying, notify, t]);

  const getPosition = useCallback(() => audioRef.current?.currentTime ?? positionRef.current, []);

  const getDuration = useCallback(() => {
    const decoded = audioRef.current?.duration;
    return decoded !== undefined && Number.isFinite(decoded) ? decoded : 0;
  }, []);

  const trackedPosition = useCallback(() => positionRef.current, []);

  const fromActive = useCallback(
    (event: SyntheticEvent<HTMLAudioElement>) => event.currentTarget === audioRef.current,
    [],
  );

  const audioProps: ComponentPropsWithoutRef<"audio"> = {
    preload: "auto",
    onTimeUpdate: (event) => fromActive(event) && handleTimeUpdate(),
    onSeeking: (event) => fromActive(event) && tracker.reposition(event.currentTarget.currentTime),
    onProgress: (event) => fromActive(event) && handleProgress(),
    onLoadedMetadata: (event) =>
      fromActive(event) && setDuration(event.currentTarget.duration || 0),
    onDurationChange: (event) =>
      fromActive(event) && setDuration(event.currentTarget.duration || 0),
    onEnded: (event) => {
      if (!fromActive(event)) return;
      setWaiting(false);
      handleEnded();
    },
    onError: (event) => {
      if (!fromActive(event)) return;
      setWaiting(false);
      handleError();
    },
    onLoadStart: (event) => {
      if (!fromActive(event)) return;
      setWaiting(true);
      handleWaiting();
    },
    onWaiting: (event) => {
      if (!fromActive(event)) return;
      setWaiting(true);
      handleWaiting();
    },
    onStalled: (event) => fromActive(event) && handleWaiting(),
    onPlay: (event) => fromActive(event) && setIsPlaying(true),
    onPause: (event) => {
      if (scrubRef.current !== null) return;
      if (
        fromActive(event) &&
        event.currentTarget.dataset.sourceLoading !== "true" &&
        !event.currentTarget.error
      ) {
        clearWaitingTimer();
        setIsPlaying(false);
      }
    },
    onPlaying: (event) => {
      if (!fromActive(event)) return;
      setWaiting(false);
      clearWaitingTimer();
      recovery.playing();
    },
  };

  return {
    audioRefs: [primaryRef, secondaryRef],
    audioProps,
    position,
    duration,
    buffered,
    buffering: waiting && isPlaying,
    getPosition,
    getDuration,
    trackedPosition,
    seek,
    seekBy,
    scrubBy,
    holdScrub,
    commitScrub,
    recoverSource,
    startQueue,
    resetProgress,
    resumeAt,
  };
}

// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/contexts/I18nContext";
import { isTypingTarget } from "@/lib/shortcuts";
import { prepareVinylDeck, releaseVinylDeck, useVinylDeck } from "@/lib/playback/vinylDeck";
import { setVinylCrossfader } from "@/lib/playback/equalizer";
import type { Track } from "@/lib/types";
import { Button } from "./ui/button";

export function DJControls({ track }: { track: Track }) {
  const t = useT();
  const status = useVinylDeck(track.id);
  const [fader, setFader] = useState(1);
  const [cutting, setCutting] = useState(false);
  const faderRef = useRef(fader);
  const held = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    void prepareVinylDeck(track.id, track.durationSeconds, controller.signal);
    return () => {
      controller.abort();
      setVinylCrossfader(1);
      releaseVinylDeck();
    };
  }, [track.id, track.durationSeconds]);

  useEffect(() => {
    const heldKeys = held.current;
    const close = (event: KeyboardEvent) => {
      const typing =
        isTypingTarget(event.target) &&
        (event.target as HTMLElement).getAttribute("type") !== "range";
      if (event.code !== "KeyX" || event.ctrlKey || event.altKey || event.metaKey || typing) return;
      event.preventDefault();
      heldKeys.add("keyboard");
      setCutting(true);
      setVinylCrossfader(0);
    };
    const open = (event: KeyboardEvent) => {
      if (event.code !== "KeyX") return;
      heldKeys.delete("keyboard");
      const cut = heldKeys.size > 0;
      setCutting(cut);
      setVinylCrossfader(cut ? 0 : faderRef.current);
    };
    const reset = () => {
      heldKeys.clear();
      setCutting(false);
      setVinylCrossfader(faderRef.current);
    };
    const hidden = () => {
      if (document.visibilityState !== "visible") reset();
    };
    window.addEventListener("keydown", close);
    window.addEventListener("keyup", open);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("keyup", open);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", hidden);
      heldKeys.clear();
      setVinylCrossfader(1);
    };
  }, []);

  const releaseCut = () => {
    held.current.delete("pointer");
    const cut = held.current.size > 0;
    setCutting(cut);
    setVinylCrossfader(cut ? 0 : faderRef.current);
  };

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border-strong bg-background/60 px-4 py-3"
      aria-label={t("settings.tatarMafia")}
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{t("settings.tatarMafia")}</span>
        <span role="status" className="text-xs text-muted-foreground">
          {t(
            status === "ready"
              ? "player.djReady"
              : status === "unavailable"
                ? "player.djUnavailable"
                : "player.djLoading",
          )}
        </span>
      </div>
      {status === "unavailable" && (
        <p className="text-xs text-muted-foreground">{t("player.djLimitHint")}</p>
      )}
      {status === "ready" && (
        <>
          <div className="flex items-center gap-4">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="dj-crossfader" className="text-xs text-muted-foreground">
                {t("player.djCrossfader")}
              </label>
              <input
                id="dj-crossfader"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={fader}
                className="h-9 w-full cursor-ew-resize accent-primary touch-none"
                aria-valuetext={t(fader <= 0.02 || cutting ? "player.djClosed" : "player.djOpen")}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  faderRef.current = value;
                  setFader(value);
                  if (!held.current.size) setVinylCrossfader(value);
                }}
              />
            </div>
            <Button
              variant={cutting ? "primary" : "secondary"}
              aria-pressed={cutting}
              aria-label={t("player.djCut")}
              className="min-w-20 touch-none select-none"
              onTouchStart={(event) => event.stopPropagation()}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                held.current.add("pointer");
                setCutting(true);
                setVinylCrossfader(0);
              }}
              onPointerUp={releaseCut}
              onPointerCancel={releaseCut}
              onLostPointerCapture={releaseCut}
              onKeyDown={(event) => {
                if (event.key !== " " && event.key !== "Enter") return;
                event.preventDefault();
                held.current.add("pointer");
                setCutting(true);
                setVinylCrossfader(0);
              }}
              onKeyUp={(event) => {
                if (event.key === " " || event.key === "Enter") releaseCut();
              }}
              onBlur={releaseCut}
            >
              Cut
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("player.djInstructions")}</p>
        </>
      )}
    </section>
  );
}

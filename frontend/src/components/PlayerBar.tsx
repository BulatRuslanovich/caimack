// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useT } from "@/contexts/I18nContext";
import { cn } from "@/lib/cn";
import { useCoverLight } from "@/lib/useCoverTone";
import { useToast } from "@/lib/useToast";
import { Maximize2Icon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { loadFullPlayer, preloadFullPlayer } from "./FullPlayerLoader";
import { Button } from "./ui/button";

const SWIPE_OPEN_PX = 40;
const SWIPE_SKIP_PX = 80;

type ExpandedPlayerRenderer = (onClose: () => void, restoreFocus: () => void) => ReactNode;

function ExpandedPlayer({
  render,
  onClose,
  restoreFocus,
}: {
  render: ExpandedPlayerRenderer;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  return render(onClose, restoreFocus);
}

export function PlayerBar({
  artworkUrl,
  artwork,
  metadata,
  mobileControls,
  transport,
  actions,
  progress,
  progressLine,
  expandedPlayer,
  next,
  previous,
  label,
}: {
  artworkUrl: string | null;
  artwork: (expanded: boolean) => ReactNode;
  metadata: ReactNode;
  mobileControls: ReactNode;
  transport: ReactNode;
  actions: ReactNode;
  progress: ReactNode;
  progressLine: ReactNode;
  expandedPlayer: ExpandedPlayerRenderer;
  next: () => void;
  previous: () => void;
  label?: string;
}) {
  const t = useT();
  const { notifyError } = useToast();
  const light = useCoverLight(artworkUrl);
  const [expanded, setExpandedNow] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const expansionRequest = useRef(0);
  const transition = useRef<ViewTransition | null>(null);
  const swipeFrom = useRef<{ x: number; y: number } | null>(null);
  const artworkButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);

  useEffect(
    () => () => {
      expansionRequest.current++;
      transition.current?.skipTransition();
      document.documentElement.removeAttribute("data-player-transition");
    },
    [],
  );

  const applyExpanded = (open: boolean) => {
    transition.current?.skipTransition();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduceMotion) {
      document.documentElement.removeAttribute("data-player-transition");
      setExpandedNow(open);
      return;
    }

    document.documentElement.setAttribute("data-player-transition", "true");
    const running = document.startViewTransition(() => flushSync(() => setExpandedNow(open)));
    transition.current = running;
    void running.ready.catch(() => undefined);
    const finish = () => {
      if (transition.current !== running) return;
      transition.current = null;
      document.documentElement.removeAttribute("data-player-transition");
    };
    void running.finished.then(finish, finish);
  };

  const open = (trigger = artworkButton.current) => {
    const request = ++expansionRequest.current;
    void loadFullPlayer()
      .then(() => {
        if (request !== expansionRequest.current) return;
        opener.current = trigger;
        applyExpanded(true);
      })
      .catch(notifyError);
  };

  const close = () => {
    expansionRequest.current++;
    applyExpanded(false);
  };

  const restoreFocus = () => {
    const trigger = opener.current;
    const target = trigger?.getClientRects().length ? trigger : artworkButton.current;
    target?.focus({ preventScroll: true });
  };

  return (
    <>
      <footer
        aria-label={label}
        className="player-shell relative min-h-(--player-height) px-5 py-1.5 [grid-area:player] max-md:px-2.5 max-md:py-2"
        style={light}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          const onSlider = (event.target as Element).closest("input, [role='slider']");
          swipeFrom.current = onSlider ? null : { x: touch.clientX, y: touch.clientY };
        }}
        onTouchMove={(event) => {
          const from = swipeFrom.current;
          if (!from) return;

          const touch = event.touches[0];
          const dx = touch.clientX - from.x;
          if (Math.abs(dx) > Math.abs(touch.clientY - from.y)) setSwipeX(dx);
        }}
        onTouchEnd={(event) => {
          const from = swipeFrom.current;
          swipeFrom.current = null;
          setSwipeX(0);
          if (!from) return;

          const touch = event.changedTouches[0];
          const dx = touch.clientX - from.x;
          const dy = from.y - touch.clientY;
          if (Math.abs(dx) > Math.abs(dy)) {
            if (dx <= -SWIPE_SKIP_PX) next();
            else if (dx >= SWIPE_SKIP_PX) previous();
          } else if (dy > SWIPE_OPEN_PX) open();
        }}
        onTouchCancel={() => {
          swipeFrom.current = null;
          setSwipeX(0);
        }}
      >
        <div className="grid h-full grid-cols-[minmax(0,1fr)_clamp(15rem,32vw,28rem)_minmax(0,1fr)] items-center gap-5 max-lg:gap-3 max-md:h-auto max-md:grid-cols-1 max-md:gap-0">
          <div
            className={cn(
              "relative flex min-w-0 items-center gap-3 max-md:gap-2.5 max-[23.75rem]:gap-1",
              swipeX === 0 && "transition-[translate,opacity] duration-200 ease-brand",
            )}
            style={{
              translate: `${swipeX}px 0`,
              opacity: 1 - Math.min(Math.abs(swipeX) / (SWIPE_SKIP_PX * 3), 0.5),
            }}
          >
            <span
              aria-hidden="true"
              onClick={() => open()}
              className="absolute inset-0 cursor-pointer md:hidden"
            />
            <button
              ref={artworkButton}
              type="button"
              onClick={(event) => open(event.currentTarget)}
              aria-label={t("player.openFull")}
              onPointerEnter={preloadFullPlayer}
              onFocus={preloadFullPlayer}
              className="player-artwork mr-2.5 shrink-0 leading-none max-md:mr-1 max-[23.75rem]:mr-0"
            >
              {artwork(expanded)}
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">{metadata}</div>
            {mobileControls}
          </div>

          <div className="flex min-w-0 flex-col items-center gap-1.5 max-md:hidden">
            {transport}
            {progress}
          </div>

          <div className="flex min-w-0 items-center justify-end gap-3 max-lg:gap-1 max-md:hidden">
            {actions}
            <Button
              variant="ghost"
              size="icon"
              onClick={(event) => open(event.currentTarget)}
              className="max-lg:hidden"
              aria-label={t("player.openFull")}
              onPointerEnter={preloadFullPlayer}
              onFocus={preloadFullPlayer}
              title={t("player.openFull")}
            >
              <Maximize2Icon size={18} />
            </Button>
          </div>
        </div>
        {progressLine}
      </footer>
      {expanded && (
        <ExpandedPlayer render={expandedPlayer} onClose={close} restoreFocus={restoreFocus} />
      )}
    </>
  );
}

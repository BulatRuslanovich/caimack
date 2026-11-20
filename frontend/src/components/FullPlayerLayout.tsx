// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useT } from "@/contexts/I18nContext";
import { cn } from "@/lib/cn";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Button } from "./ui/button";

export const fullPlayerStage =
  "relative z-1 flex min-h-0 flex-1 gap-[clamp(2rem,5vw,5rem)] max-lg:-mx-5 max-lg:flex-col max-lg:overflow-x-hidden max-lg:px-5";
export const fullPlayerControls = "flex w-full max-w-[34rem] flex-col gap-6 max-lg:mx-auto";

export function FullPlayerLayout({
  onClose,
  stage,
  artworkShown = true,
  backdrop,
  actions,
  chrome,
  children,
}: {
  onClose: () => void;
  stage: RefObject<HTMLDivElement | null>;
  artworkShown?: boolean;
  backdrop: ReactNode;
  actions: ReactNode;
  chrome?: string;
  children: ReactNode;
}) {
  const t = useT();
  const label = t("player.nowPlaying");
  const swipeFrom = useRef<number | null>(null);

  useEffect(() => {
    let lock: Promise<WakeLockSentinel | undefined> | undefined;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      lock = navigator.wakeLock?.request("screen").catch(() => undefined);
    };

    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      void lock?.then((sentinel) => sentinel?.release());
    };
  }, []);

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content asChild aria-describedby={undefined}>
          <div
            data-player-fullscreen="true"
            data-aura-host
            onTouchStart={(event) => {
              const target = event.target as Element;
              const interactive = target.closest(
                "button, a, input, select, textarea, [role='slider'], [role='menu']",
              );
              const atTop = (stage.current?.scrollTop ?? 0) === 0;
              const insidePlayer =
                target.closest("[data-player-fullscreen]") === event.currentTarget;
              swipeFrom.current =
                artworkShown && atTop && !interactive && insidePlayer
                  ? event.touches[0].clientY
                  : null;
            }}
            onTouchCancel={() => {
              swipeFrom.current = null;
            }}
            onTouchEnd={(event) => {
              const from = swipeFrom.current;
              swipeFrom.current = null;
              if (from !== null && event.changedTouches[0].clientY - from > 120) onClose();
            }}
            className="fixed inset-0 z-90 flex flex-col overflow-hidden bg-background px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          >
            <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
            {backdrop}
            <header
              className={cn(
                "relative z-1 grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 max-sm:flex max-sm:justify-between max-sm:gap-0",
                chrome,
              )}
            >
              <Button
                variant="ghost"
                size="icon-lg"
                className="justify-self-start max-sm:size-10"
                onClick={onClose}
                aria-label={t("player.closeFull")}
              >
                <ChevronDownIcon size={22} />
              </Button>
              <span className="min-w-0 truncate text-sm text-muted-foreground">{label}</span>
              {actions}
            </header>
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useT } from "@/contexts/I18nContext";
import { usePlayerUi } from "@/contexts/PlayerUiContext";
import { cn } from "@/lib/cn";
import { PinIcon, PinOffIcon, XIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "./ui/button";

import { QueueList } from "./QueueList";
export { QueueList } from "./QueueList";

export function QueuePanel({ onClose, docked = false }: { onClose: () => void; docked?: boolean }) {
  const t = useT();
  const { queuePinned, setQueuePinned } = usePlayerUi();

  useEffect(() => {
    if (docked) return;
    const close = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')
      )
        onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [docked, onClose]);

  return (
    <aside
      aria-label={t("queue.label")}
      data-queue-panel={docked ? "docked" : "floating"}
      className={cn(
        "queue-panel flex min-h-0 min-w-0 flex-col p-3.5",
        docked
          ? "queue-panel-docked border-l border-border [grid-area:queue]"
          : "fixed right-4 bottom-[calc(var(--player-height)+0.75rem)] z-50 max-h-[min(60vh,32.5rem)] w-[min(22.5rem,calc(100vw-2rem))] rounded-lg bg-popover shadow-pop animate-in duration-200 fade-in-0 slide-in-from-bottom-3 max-md:inset-x-3 max-md:bottom-[calc(var(--player-height)+var(--mobile-nav-height)+env(safe-area-inset-bottom)+0.625rem)] max-md:max-h-[min(52dvh,26rem)] max-md:w-auto",
      )}
    >
      <header className="mb-2 flex shrink-0 items-center justify-between">
        <h3 className="text-section font-semibold">{t("queue.title")}</h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="max-xl:hidden"
            onClick={() => setQueuePinned(!queuePinned)}
            aria-label={queuePinned ? t("queue.unpin") : t("queue.pin")}
            title={queuePinned ? t("queue.unpin") : t("queue.pin")}
            aria-pressed={queuePinned}
          >
            {queuePinned ? <PinOffIcon size={16} /> : <PinIcon size={16} />}
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("queue.close")}>
            <XIcon size={16} />
          </Button>
        </div>
      </header>

      <QueueList />
    </aside>
  );
}

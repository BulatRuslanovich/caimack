// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState, type ReactNode } from "react";
import { EllipsisVerticalIcon } from "lucide-react";
import { useT } from "@/contexts/I18nContext";
import type { Track } from "@/lib/types";
import { SleepTimerButton } from "./SleepTimerButton";
import { StreamQuality } from "./StreamQuality";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";

export function PlayerOptionsMenu({
  track,
  children,
  onOpenChange,
}: {
  track: Track;
  children?: (close: () => void) => ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const change = (value: boolean) => {
    setOpen(value);
    onOpenChange?.(value);
  };
  return (
    <>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={t("player.options")}
        onClick={() => change(true)}
      >
        <EllipsisVerticalIcon size={20} />
      </Button>
      <Sheet open={open} onOpenChange={change}>
        <SheetContent className="mx-auto max-w-md gap-3 px-5">
          <SheetTitle className="text-section font-semibold">{t("player.options")}</SheetTitle>
          <div className="flex min-h-12 items-center justify-between gap-3">
            <span>{t("sleep.label")}</span>
            <SleepTimerButton size="icon-lg" />
          </div>
          <div className="flex min-h-12 items-center justify-between gap-3">
            <span>{t("settings.quality")}</span>
            <StreamQuality track={track} />
          </div>
          {children?.(() => change(false))}
          <Button variant="ghost" onClick={() => change(false)}>
            {t("action.close")}
          </Button>
        </SheetContent>
      </Sheet>
    </>
  );
}

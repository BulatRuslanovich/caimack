// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/format";
import {
  SLEEP_TIMER_MINUTES,
  useSleepCountdown,
  type SleepTimerChoice,
} from "@/lib/playback/useSleepTimer";
import { useToast } from "@/lib/useToast";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { useT } from "@/contexts/I18nContext";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { CheckIcon, MoonIcon, MoonStarIcon } from "lucide-react";

export function SleepTimerButton({
  size = "icon",
  className,
}: {
  size?: "icon" | "icon-lg";
  className?: string;
}) {
  const { sleepTimer } = usePlayerState();
  const { setSleepTimer } = usePlayerActions();
  const { notify } = useToast();
  const t = useT();
  const remaining = useSleepCountdown(sleepTimer);

  const active = sleepTimer !== null;
  const label =
    remaining !== null
      ? t("sleep.remaining", { time: formatDuration(remaining) })
      : sleepTimer?.kind === "trackEnd"
        ? t("sleep.atTrackEnd")
        : t("sleep.label");

  const choose = (choice: SleepTimerChoice) => {
    setSleepTimer(choice);

    if (choice === null) notify(t("sleep.cancelled"), "info");
    else if (choice === "trackEnd") notify(t("sleep.startedTrackEnd"), "info");
    else notify(t("sleep.started", { count: choice }), "info");
  };

  const chosenMinutes = sleepTimer?.kind === "minutes" ? sleepTimer.minutes : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={active ? "auto" : size}
          className={cn(
            active &&
              "gap-1.5 rounded-full px-2.5 text-primary hover:text-primary [&_svg]:shrink-0",
            active && (size === "icon-lg" ? "h-11" : "h-9 max-md:h-10"),
            className,
          )}
          aria-label={label}
          title={label}
        >
          {active ? <MoonStarIcon size={size === "icon-lg" ? 20 : 18} /> : <MoonIcon size={18} />}
          {remaining !== null && (
            <span className="text-xs tabular-nums">{formatDuration(remaining)}</span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="min-w-[11rem]">
        <DropdownMenuLabel>{t("sleep.label")}</DropdownMenuLabel>

        {SLEEP_TIMER_MINUTES.map((minutes) => (
          <DropdownMenuItem key={minutes} onSelect={() => choose(minutes)}>
            <span className="flex-1">{t("sleep.minutes", { count: minutes })}</span>
            {chosenMinutes === minutes && <CheckIcon aria-hidden="true" />}
          </DropdownMenuItem>
        ))}

        <DropdownMenuItem onSelect={() => choose("trackEnd")}>
          <span className="flex-1">{t("sleep.trackEnd")}</span>
          {sleepTimer?.kind === "trackEnd" && <CheckIcon aria-hidden="true" />}
        </DropdownMenuItem>

        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => choose(null)}>{t("sleep.off")}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

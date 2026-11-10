// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useT } from "@/contexts/I18nContext";
import type { Track } from "@/lib/types";
import { Slot } from "@radix-ui/react-slot";
import { EllipsisVerticalIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { type ReactElement, useState, useSyncExternalStore } from "react";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "./ui/dropdown-menu";

const TrackMenuBody = dynamic(() =>
  import("./track-menu/TrackMenuBody").then((m) => m.TrackMenuBody),
);

export interface TrackMenuProps {
  track: Track;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlistId?: string;
  playlistTrackIds?: string[];
  onChanged?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onNavigate?: () => void;
  trigger?: ReactElement;
}

const COMPACT = "(width < 56.25rem)";

function subscribeCompact(onChange: () => void) {
  const query = window.matchMedia(COMPACT);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

import { SheetMenu } from "./track-menu/MenuPrimitives";

export function TrackMenu({ open, onOpenChange, trigger, ...rest }: TrackMenuProps) {
  const t = useT();
  const [everOpened, setEverOpened] = useState(open);
  const compact = useSyncExternalStore(
    subscribeCompact,
    () => window.matchMedia(COMPACT).matches,
    () => false,
  );

  if (open && !everOpened) setEverOpened(true);

  const button = trigger ?? (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("tracks.moreActions", { title: rest.track.title })}
    >
      <EllipsisVerticalIcon size={16} />
    </Button>
  );

  if (compact) {
    return (
      <SheetMenu.Provider value={{ open, onOpenChange }}>
        <Slot onClick={() => onOpenChange(true)}>{button}</Slot>
        {everOpened && <TrackMenuBody {...rest} onOpenChange={onOpenChange} />}
      </SheetMenu.Provider>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>

      {everOpened && <TrackMenuBody {...rest} onOpenChange={onOpenChange} />}
    </DropdownMenu>
  );
}

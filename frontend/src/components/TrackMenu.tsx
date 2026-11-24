// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useT } from "@/contexts/I18nContext";
import type { Track } from "@/lib/types";
import { Slot } from "@radix-ui/react-slot";
import { EllipsisVerticalIcon } from "lucide-react";
import { type ReactElement, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "./ui/dropdown-menu";

import { PlaylistMembershipDialog } from "./PlaylistMembershipDialog";
import type { ReturnFocus } from "./PlaylistActionDialog";
import { TrackMenuBody } from "./track-menu/TrackMenuBody";

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
  onOpenMembership?: (track: Track, returnFocus: ReturnFocus) => void;
  trigger?: ReactElement;
}

const COMPACT = "(width < 56.25rem)";

function subscribeCompact(onChange: () => void) {
  const query = window.matchMedia(COMPACT);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

import { SheetMenu } from "./track-menu/MenuPrimitives";

export function TrackMenu({
  open,
  onOpenChange,
  trigger,
  onOpenMembership,
  ...rest
}: TrackMenuProps) {
  const t = useT();
  const [everOpened, setEverOpened] = useState(open);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [membershipTrack, setMembershipTrack] = useState<Track | null>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const returnFocus = () => triggerRef.current;
  const openMembership = () => {
    if (onOpenMembership) onOpenMembership(rest.track, returnFocus);
    else setMembershipTrack(rest.track);
  };
  const membership = membershipTrack && (
    <PlaylistMembershipDialog
      key={membershipTrack.id}
      track={membershipTrack}
      onClose={() => setMembershipTrack(null)}
      returnFocus={returnFocus}
    />
  );
  const compact = useSyncExternalStore(
    subscribeCompact,
    () => window.matchMedia(COMPACT).matches,
    () => false,
  );

  if (open && !everOpened) setEverOpened(true);

  const button = (
    <Slot ref={triggerRef}>
      {trigger ?? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("tracks.moreActions", { title: rest.track.title })}
        >
          <EllipsisVerticalIcon size={16} />
        </Button>
      )}
    </Slot>
  );

  if (!compact && !everOpened && !open) {
    return (
      <Slot
        aria-haspopup="menu"
        aria-expanded={false}
        data-state="closed"
        onClick={(event) => {
          setKeyboardOpen(event.detail === 0);
          onOpenChange(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setKeyboardOpen(true);
            onOpenChange(true);
          }
        }}
      >
        {button}
      </Slot>
    );
  }

  if (compact) {
    return (
      <>
        <SheetMenu.Provider value={{ open, onOpenChange }}>
          <Slot onClick={() => onOpenChange(true)}>{button}</Slot>
          {everOpened && (
            <TrackMenuBody {...rest} onOpenChange={onOpenChange} openMembership={openMembership} />
          )}
        </SheetMenu.Provider>
        {membership}
      </>
    );
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>

        {everOpened && (
          <TrackMenuBody
            {...rest}
            onOpenChange={onOpenChange}
            initialKeyboardFocus={keyboardOpen}
            openMembership={openMembership}
          />
        )}
      </DropdownMenu>
      {membership}
    </>
  );
}

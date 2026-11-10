// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { cn } from "@/lib/cn";
import { formatArtists } from "@/lib/format";
import type { Track } from "@/lib/types";
import { Slot } from "@radix-ui/react-slot";
import { ChevronDownIcon } from "lucide-react";
import { createContext, type ReactNode, useContext, useState } from "react";
import { TrackCover } from "../Cover";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "../ui/sheet";

export const SheetMenu = createContext<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
} | null>(null);

const sheetRow = cn(
  "sheet-menu-item hover:no-underline disabled:pointer-events-none disabled:text-faint",
);

export function MenuContent({ track, children }: { track: Track; children: ReactNode }) {
  const sheet = useContext(SheetMenu);

  if (!sheet)
    return (
      <DropdownMenuContent className="w-72">
        <DropdownMenuLabel className="flex items-center gap-3 p-3">
          <TrackCover track={track} size={40} />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-sm font-semibold text-foreground">{track.title}</span>
            <span className="truncate text-xs font-normal">{formatArtists(track)}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {children}
      </DropdownMenuContent>
    );

  return (
    <Sheet open={sheet.open} onOpenChange={sheet.onOpenChange}>
      <SheetContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
      >
        <div className="flex items-center gap-3 px-3 pt-1 pb-4">
          <TrackCover track={track} size={52} />
          <span className="flex min-w-0 flex-col">
            <SheetTitle className="truncate text-base font-semibold">{track.title}</SheetTitle>
            <span className="truncate text-sm text-muted-foreground">{formatArtists(track)}</span>
          </span>
        </div>
        <MenuSeparator />
        {children}
      </SheetContent>
    </Sheet>
  );
}

export function MenuItem({
  onSelect,
  disabled,
  variant,
  asChild,
  children,
}: {
  onSelect?: (event: Event) => void;
  disabled?: boolean;
  variant?: "destructive";
  asChild?: boolean;
  children: ReactNode;
}) {
  const sheet = useContext(SheetMenu);

  if (!sheet) {
    return (
      <DropdownMenuItem onSelect={onSelect} disabled={disabled} variant={variant} asChild={asChild}>
        {children}
      </DropdownMenuItem>
    );
  }

  const run = () => {
    const select = new Event("select", { cancelable: true });
    onSelect?.(select);
    if (!select.defaultPrevented) sheet.onOpenChange(false);
  };

  const className = cn(sheetRow, variant === "destructive" && "text-destructive");

  return asChild ? (
    <Slot className={className} data-variant={variant} onClick={run}>
      {children}
    </Slot>
  ) : (
    <button
      type="button"
      disabled={disabled}
      className={className}
      data-variant={variant}
      onClick={run}
    >
      {children}
    </button>
  );
}

export function MenuSeparator() {
  const sheet = useContext(SheetMenu);

  return sheet ? <div className="floating-separator shrink-0" /> : <DropdownMenuSeparator />;
}

export function MenuSub({ label, children }: { label: ReactNode; children: ReactNode }) {
  const sheet = useContext(SheetMenu);
  const [expanded, setExpanded] = useState(false);

  if (!sheet) {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>{children}</DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
        className={sheetRow}
      >
        {label}
        <ChevronDownIcon className={cn("ml-auto text-faint", expanded && "rotate-180")} />
      </button>
      {expanded && <div className="ml-5 flex flex-col border-l border-border pl-2">{children}</div>}
    </>
  );
}

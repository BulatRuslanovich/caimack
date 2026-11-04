// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { keepOpenOnToast } from "./sonner";

export const Sheet = DialogPrimitive.Root;
export const SheetTitle = DialogPrimitive.Title;

export function SheetContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-95 bg-black/60",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        )}
      />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        onInteractOutside={keepOpenOnToast}
        className={cn(
          "fixed z-95 flex flex-col overflow-y-auto bg-popover shadow-pop outline-none",
          "inset-x-0 bottom-0 max-h-[82dvh] rounded-t-2xl px-3 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))]",
          "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-1.5 mb-2.5 h-1 w-9 shrink-0 rounded-full bg-border-strong" />
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { XIcon } from "lucide-react";
import { useT } from "@/contexts/I18nContext";
import { Button } from "./button";
import { keepOpenOnToast } from "./sonner";

export const Dialog = DialogPrimitive.Root;

function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "overlay-scrim fixed inset-0 z-100 grid place-items-center overflow-y-auto p-5 max-md:p-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  children,
  title,
  description,
  footer,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  title: string;
  description?: string;
  footer?: ReactNode;
}) {
  const t = useT();

  return (
    <DialogPrimitive.Portal>
      <DialogOverlay>
        <DialogPrimitive.Content
          data-slot="dialog-content"
          {...(description ? {} : { "aria-describedby": undefined })}
          onInteractOutside={keepOpenOnToast}
          className={cn(
            "dialog-panel relative flex max-h-[88dvh] w-[min(36rem,100%)] flex-col overflow-hidden",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            className,
          )}
          {...props}
        >
          <header className="dialog-header flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="text-sm text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>

            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t("action.close")}>
                <XIcon size={16} />
              </Button>
            </DialogPrimitive.Close>
          </header>

          <div className="dialog-body min-h-0 flex-1 overflow-y-auto">{children}</div>

          {footer && (
            <footer className="dialog-footer flex flex-wrap gap-2.5 max-md:[&>*]:flex-1">
              {footer}
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogOverlay>
    </DialogPrimitive.Portal>
  );
}

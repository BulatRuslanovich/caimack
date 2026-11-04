// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { CircleAlertIcon, CircleCheckIcon, XIcon } from "lucide-react";
import { Toaster as Sonner } from "sonner";
import { useT } from "@/contexts/I18nContext";

export function keepOpenOnToast(event: Event) {
  if (event.target instanceof Element && event.target.closest("[data-sonner-toaster]")) {
    event.preventDefault();
  }
}

export function Toaster() {
  const t = useT();

  return (
    <Sonner
      position="top-right"
      offset={18}
      mobileOffset={{ top: "max(0.75rem, env(safe-area-inset-top))", left: 12, right: 12 }}
      gap={10}
      className="pointer-events-auto"
      closeButton
      icons={{
        success: <CircleCheckIcon size={18} />,
        error: <CircleAlertIcon size={18} />,
        close: <XIcon size={16} />,
      }}
      toastOptions={{
        unstyled: true,
        closeButtonAriaLabel: t("action.close"),
        classNames: {
          toast: [
            "flex w-full items-center gap-3 rounded-lg bg-popover py-2 pr-2 pl-3.5 font-sans text-sm text-popover-foreground shadow-pop",
            "min-h-12 data-[expanded=false]:data-[front=false]:*:opacity-0",
          ].join(" "),
          icon: "flex shrink-0",
          content: "min-w-0 flex-1 py-1",
          title: "leading-snug text-pretty",
          success: "[&_[data-icon]]:text-success",
          error: "[&_[data-icon]]:text-destructive",
          actionButton:
            "h-8 shrink-0 rounded-full px-3 text-sm font-medium text-primary transition-colors hover:bg-primary-soft",
          closeButton:
            "order-last grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        },
      }}
    />
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useT } from "@/contexts/I18nContext";

type ToastTone = "info" | "success" | "error";

interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastState {
  notify: (message: string, tone?: ToastTone, action?: ToastAction) => void;
  notifyError: (error: unknown, fallback?: string) => void;
}

const VISIBLE_MS: Record<ToastTone, number> = {
  info: 4_000,
  success: 4_000,
  error: 60_000,
};

const ACTION_VISIBLE_MS = 10_000;

export function useToast(): ToastState {
  const t = useT();

  const notify = useCallback((message: string, tone: ToastTone = "info", action?: ToastAction) => {
    const options = {
      id: `${tone}:${message}`,
      duration: action ? ACTION_VISIBLE_MS : VISIBLE_MS[tone],
      action: action && { label: action.label, onClick: action.run },
    };

    if (tone === "success") toast.success(message, options);
    else if (tone === "error") toast.error(message, options);
    else toast(message, options);
  }, []);

  const notifyError = useCallback(
    (error: unknown, fallback?: string) => {
      const message =
        error instanceof Error && error.message ? error.message : (fallback ?? t("error.generic"));
      notify(message, "error");
    },
    [notify, t],
  );

  return useMemo(() => ({ notify, notifyError }), [notify, notifyError]);
}

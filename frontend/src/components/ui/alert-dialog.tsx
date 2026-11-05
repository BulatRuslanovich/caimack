// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useT } from "@/contexts/I18nContext";
import { Button } from "./button";

function AlertDialogContent({
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
}: {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay
        className={cn(
          "overlay-scrim fixed inset-0 z-100 grid place-items-center overflow-y-auto p-5",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        )}
      >
        <AlertDialogPrimitive.Content
          className={cn(
            "dialog-panel w-[min(28rem,100%)] p-6",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          )}
        >
          <AlertDialogPrimitive.Title className="dialog-title">{title}</AlertDialogPrimitive.Title>

          {description && (
            <AlertDialogPrimitive.Description className="mt-2 text-sm text-muted-foreground">
              {description}
            </AlertDialogPrimitive.Description>
          )}

          <div className="mt-5 flex flex-wrap justify-end gap-2.5 max-md:[&>*]:flex-1">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline">{cancelLabel}</Button>
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action asChild>
              <Button variant={destructive ? "destructive" : "primary"} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Overlay>
    </AlertDialogPrimitive.Portal>
  );
}

interface ConfirmRequest {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  action: () => void;
}

export function useConfirm(): [(request: ConfirmRequest) => void, ReactNode] {
  const t = useT();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const pending = useRef<(() => void) | null>(null);

  const confirm = useCallback((next: ConfirmRequest) => {
    pending.current = next.action;
    setRequest(next);
  }, []);

  const dialog = (
    <AlertDialogPrimitive.Root
      open={request !== null}
      onOpenChange={(open) => !open && setRequest(null)}
    >
      {request && (
        <AlertDialogContent
          title={request.title}
          description={request.description}
          confirmLabel={request.confirmLabel ?? t("action.confirm")}
          cancelLabel={t("action.cancel")}
          destructive={request.destructive}
          onConfirm={() => pending.current?.()}
        />
      )}
    </AlertDialogPrimitive.Root>
  );

  return [confirm, dialog];
}

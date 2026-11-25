// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent } from "./ui/dialog";

export type ReturnFocus = () => HTMLElement | null;

export function restoreDialogFocus(returnFocus: ReturnFocus | undefined) {
  if (!returnFocus) return undefined;
  return (event: Event) => {
    event.preventDefault();
    returnFocus()?.focus({ preventScroll: true });
  };
}

export function PlaylistActionDialog({
  title,
  children,
  footer,
  busy,
  onClose,
  returnFocus,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  busy?: boolean;
  onClose: () => void;
  returnFocus: ReturnFocus;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        title={title}
        footer={footer}
        bottomOnCompact
        onCloseAutoFocus={restoreDialogFocus(returnFocus)}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import type { ReactNode } from "react";
import type { FieldValues, SubmitHandler, UseFormReturn } from "react-hook-form";
import { useT } from "@/contexts/I18nContext";
import { useToast } from "@/lib/useToast";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";

export function FormDialog<TInput extends FieldValues, TOutput extends FieldValues = TInput>({
  title,
  description,
  form,
  onSubmit,
  onClose,
  successMessage,
  errorMessage,
  submitLabel,
  pendingLabel,
  children,
}: {
  title: string;
  description?: string;
  form: UseFormReturn<TInput, unknown, TOutput>;
  onSubmit: SubmitHandler<TOutput>;
  onClose: () => void;
  successMessage?: string | ((values: TOutput) => string);
  errorMessage: string;
  submitLabel?: string;
  pendingLabel?: string;
  children: ReactNode;
}) {
  const t = useT();
  const { notify, notifyError } = useToast();

  const saving = form.formState.isSubmitting;

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values);
      if (successMessage)
        notify(
          typeof successMessage === "function" ? successMessage(values) : successMessage,
          "success",
        );
      onClose();
    } catch (reason) {
      notifyError(reason, errorMessage);
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent
        title={title}
        description={description}
        footer={
          <>
            <Button variant="primary" form="form-dialog" type="submit" disabled={saving}>
              {saving
                ? (pendingLabel ?? t("action.saving"))
                : (submitLabel ?? t("action.saveChanges"))}
            </Button>
            <Button variant="outline" onClick={onClose} disabled={saving}>
              {t("action.cancel")}
            </Button>
          </>
        }
      >
        <form
          id="form-dialog"
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-4"
        >
          {children}
        </form>
      </DialogContent>
    </Dialog>
  );
}

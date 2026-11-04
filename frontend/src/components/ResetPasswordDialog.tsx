// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { api } from "@/lib/api";
import { limits, passwordResetSchema, type PasswordResetValues } from "@/lib/schemas";
import { useT } from "@/contexts/I18nContext";
import { FormDialog } from "./FormDialog";
import { TextField } from "./ui/form";

export function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: { id: string; username: string };
  onClose: () => void;
}) {
  const t = useT();

  const form = useForm<PasswordResetValues>({
    resolver: zodResolver(passwordResetSchema),
    defaultValues: { next: "", repeat: "" },
  });

  const errors = form.formState.errors;

  return (
    <FormDialog
      title={t("admin.resetPasswordFor", { username: user.username })}
      form={form}
      onSubmit={({ next }) => api.resetUserPassword(user.id, next)}
      onClose={onClose}
      successMessage={t("admin.passwordReset")}
      errorMessage={t("admin.actionFailed")}
      submitLabel={t("admin.resetPassword")}
      pendingLabel={t("action.saving")}
    >
      <TextField
        label={t("settings.newPassword")}
        type="password"
        autoComplete="new-password"
        registration={form.register("next")}
        error={errors.next && t("form.passwordShort", { count: limits.password.min })}
      />

      <TextField
        label={t("settings.repeatPassword")}
        type="password"
        autoComplete="new-password"
        registration={form.register("repeat")}
        error={errors.repeat && t("settings.passwordMismatch")}
      />
    </FormDialog>
  );
}

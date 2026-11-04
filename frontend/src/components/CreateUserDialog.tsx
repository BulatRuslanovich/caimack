// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { api } from "@/lib/api";
import { limits, newUserSchema, type NewUserValues } from "@/lib/schemas";
import { useT } from "@/contexts/I18nContext";
import { useToast } from "@/lib/useToast";
import { FormDialog } from "./FormDialog";
import { CheckboxField, TextField } from "./ui/form";

export function CreateUserDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: () => void;
}) {
  const t = useT();
  const { notify } = useToast();

  const form = useForm<NewUserValues>({
    resolver: zodResolver(newUserSchema),
    defaultValues: { username: "", password: "", isAdmin: false },
  });

  const errors = form.formState.errors;

  return (
    <FormDialog
      title={t("dialog.addUser.title")}
      form={form}
      onClose={onClose}
      submitLabel={t("dialog.addUser.submit")}
      pendingLabel={t("action.creating")}
      errorMessage={t("dialog.addUser.failed")}
      onSubmit={async ({ username, password, isAdmin }) => {
        const created = await api.createUser({ username, password, isAdmin });

        notify(t("dialog.addUser.created", { username: created.username }), "success");
        onCreated?.();
      }}
    >
      <TextField
        label={t("field.username")}
        registration={form.register("username")}
        error={errors.username && t("form.username")}
        maxLength={limits.username}
        autoComplete="off"
        spellCheck={false}
        autoFocus
      />

      <TextField
        label={t("field.password")}
        type="password"
        registration={form.register("password")}
        error={errors.password && t("form.passwordShort", { count: limits.password.min })}
        autoComplete="new-password"
      />

      <CheckboxField control={form.control} name="isAdmin" label={t("dialog.addUser.isAdmin")} />
    </FormDialog>
  );
}

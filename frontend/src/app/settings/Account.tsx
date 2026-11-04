// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api } from "@/lib/api";
import { limits, passwordChangeSchema, type PasswordChangeValues } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/form";
import { useT } from "@/contexts/I18nContext";
import { useToast } from "@/lib/useToast";
import { AccountSecurity } from "./AccountSecurity";
import { Panel } from "./Panel";

export function Account() {
  const t = useT();
  const { notify } = useToast();

  const form = useForm<PasswordChangeValues>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { current: "", next: "", repeat: "" },
  });

  const changePassword = useMutation({
    mutationFn: ({ current, next }: PasswordChangeValues) => api.changePassword(current, next),
    onSuccess: () => {
      form.reset();
      notify(t("settings.passwordChanged"), "success");
    },
  });

  const submit = form.handleSubmit((values) => changePassword.mutate(values));

  const errors = form.formState.errors;

  return (
    <div className="flex flex-col gap-5">
      <Panel title={t("settings.account")}>
        <form
          onSubmit={(event) => void submit(event)}
          className="flex max-w-sm flex-col gap-3"
          noValidate
        >
          <TextField
            label={t("settings.currentPassword")}
            type="password"
            autoComplete="current-password"
            registration={form.register("current")}
            error={errors.current && t("form.required")}
          />

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

          <Button
            variant="primary"
            type="submit"
            className="mt-1 self-start"
            disabled={changePassword.isPending}
          >
            {t("settings.changePassword")}
          </Button>
        </form>
      </Panel>
      <AccountSecurity />
    </div>
  );
}

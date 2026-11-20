// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { api } from "@/lib/api";
import { queries } from "@/lib/queries";
import { limits, passwordChangeSchema, type PasswordChangeValues } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/form";
import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/contexts/I18nContext";
import { useToast } from "@/lib/useToast";
import { AccountSecurity } from "./AccountSecurity";

export function Account() {
  const { user } = useAuth();
  const t = useT();

  return (
    <div className="account-settings">
      {user && (
        <header className="account-profile flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary uppercase"
          >
            {Array.from(user.username.trim())[0]}
          </span>
          <div className="min-w-0">
            <h2 className="text-left text-base font-semibold wrap-anywhere">{user.username}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t(user.isAdmin ? "admin.roleAdmin" : "admin.roleUser")}
            </p>
          </div>
        </header>
      )}
      <div className="account-layout">
        <PasswordForm username={user?.username} />
        <AccountSecurity />
      </div>
    </div>
  );
}

function PasswordForm({ username }: { username?: string }) {
  const t = useT();
  const { notify } = useToast();
  const client = useQueryClient();

  const form = useForm<PasswordChangeValues>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { current: "", next: "", repeat: "" },
  });

  const changePassword = useMutation({
    mutationFn: ({ current, next }: PasswordChangeValues) => api.changePassword(current, next),
    meta: { handlesError: true },
    onSuccess: async () => {
      form.reset();
      notify(t("settings.passwordChanged"), "success");
      await client.invalidateQueries({ queryKey: queries.sessions().queryKey });
    },
  });

  const submit = form.handleSubmit((values) => changePassword.mutate(values));

  const errors = form.formState.errors;

  return (
    <section className="account-panel" aria-labelledby="account-password">
      <h2 id="account-password" className="account-panel-title">
        <KeyRoundIcon size={18} aria-hidden="true" />
        {t("account.password")}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">{t("account.passwordHint")}</p>
      <form className="max-w-sm" onSubmit={(event) => void submit(event)} noValidate>
        {username && (
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={username}
            readOnly
            hidden
          />
        )}
        <fieldset
          className="mt-5 flex min-w-0 flex-col gap-3.5"
          disabled={changePassword.isPending}
          aria-labelledby="account-password"
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

          {changePassword.isError && (
            <p role="alert" className="text-sm text-destructive">
              {changePassword.error.message || t("error.generic")}
            </p>
          )}
          <Button variant="primary" type="submit" className="mt-1 self-start">
            {t(changePassword.isPending ? "account.passwordSaving" : "settings.changePassword")}
          </Button>
        </fieldset>
      </form>
    </section>
  );
}

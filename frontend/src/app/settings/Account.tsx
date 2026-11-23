// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
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
  return (
    <div className="account-settings">
      <AccountProfile />
      <AccountSecurity />
    </div>
  );
}

function AccountProfile() {
  const { user } = useAuth();
  const t = useT();
  const { notify } = useToast();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const formId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  const form = useForm<PasswordChangeValues>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { current: "", next: "", repeat: "" },
  });
  const { reset, setFocus } = form;

  useEffect(() => {
    if (editing) {
      restoreFocus.current = true;
      setFocus("current");
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus();
    }
  }, [editing, setFocus]);

  const changePassword = useMutation({
    mutationFn: ({ current, next }: PasswordChangeValues) => api.changePassword(current, next),
    meta: { handlesError: true },
    onSuccess: async () => {
      reset();
      setEditing(false);
      notify(t("settings.passwordChanged"), "success");
      await client.invalidateQueries({ queryKey: queries.sessions().queryKey });
    },
  });

  const submit = form.handleSubmit((values) => changePassword.mutate(values));

  const errors = form.formState.errors;

  return (
    <section className="account-panel" aria-label={t("settings.account")}>
      <header className="account-section-header">
        {user && (
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary uppercase"
            >
              {Array.from(user.username.trim())[0]}
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold wrap-anywhere">{user.username}</h2>
              <p className="text-sm text-muted-foreground">
                {t(user.isAdmin ? "admin.roleAdmin" : "admin.roleUser")}
              </p>
            </div>
          </div>
        )}
        <Button
          ref={trigger}
          variant="outline"
          size="sm"
          className="pointer-coarse:h-11"
          aria-expanded={editing}
          aria-controls={formId}
          disabled={editing && changePassword.isPending}
          onClick={() => {
            if (editing) {
              reset();
              changePassword.reset();
            }
            setEditing(!editing);
          }}
        >
          {t(editing ? "action.cancel" : "settings.changePassword")}
        </Button>
      </header>
      <div id={formId} hidden={!editing}>
        {editing && (
          <form className="mt-4 max-w-md" onSubmit={(event) => void submit(event)} noValidate>
            {user && (
              <input
                type="text"
                name="username"
                autoComplete="username"
                value={user.username}
                readOnly
                hidden
              />
            )}
            <p id={`${formId}-hint`} className="text-sm text-muted-foreground">
              {t("account.passwordHint")}
            </p>
            <fieldset
              className="mt-4 flex min-w-0 flex-col gap-3"
              disabled={changePassword.isPending}
              aria-label={t("account.password")}
              aria-describedby={`${formId}-hint`}
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
        )}
      </div>
    </section>
  );
}

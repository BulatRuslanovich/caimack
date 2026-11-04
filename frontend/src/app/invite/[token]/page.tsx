// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { api } from "@/lib/api";
import { inviteSchema, limits, type InviteValues } from "@/lib/schemas";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { useToast } from "@/lib/useToast";
import { BrandMark, BrandWordmark } from "@/components/Brand";
import { Copyright } from "@/components/Copyright";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { Loading } from "@/components/Loading";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/form";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const { register } = useAuth();
  const { notifyError } = useToast();
  const { t, locale } = useI18n();
  const router = useRouter();

  const invitation = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api.invitation(token),
    retry: false,
  });

  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { username: "", password: "", repeat: "" },
  });

  const submit = form.handleSubmit(async ({ username, password }) => {
    try {
      await register(token, username, password);
      router.replace("/");
    } catch (reason) {
      notifyError(reason);
    }
  });

  const errors = form.formState.errors;
  const submitting = form.formState.isSubmitting;

  return (
    <div className="relative grid min-h-dvh justify-items-center bg-background p-6 [align-items:safe_center]">
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <LocaleSwitcher />
        <ThemeSwitcher />
      </div>

      <div className="w-[min(24rem,100%)] rounded-lg bg-card p-5">
        <div className="mb-4 flex flex-col items-center gap-2 text-center">
          <BrandMark className="size-18" />
          <h1>
            <BrandWordmark className="text-xl" />
          </h1>
          <p className="font-medium">{t("invite.title")}</p>
        </div>

        {invitation.isPending && <Loading size="s" />}

        {invitation.isError && (
          <p className="text-center text-sm text-muted-foreground">{t("invite.invalid")}</p>
        )}

        {invitation.data && (
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
            <p className="text-sm text-muted-foreground">
              {t("invite.hint")}{" "}
              {t("invite.expires", {
                date: new Date(invitation.data.expiresAt).toLocaleDateString(locale, {
                  day: "numeric",
                  month: "long",
                }),
              })}
            </p>

            <TextField
              label={t("field.username")}
              id="username"
              registration={form.register("username")}
              error={errors.username && t("form.username")}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={submitting}
            />

            <TextField
              label={t("field.password")}
              id="password"
              type="password"
              registration={form.register("password")}
              error={errors.password && t("form.passwordShort", { count: limits.password.min })}
              autoComplete="new-password"
              disabled={submitting}
            />

            <TextField
              label={t("invite.repeatPassword")}
              id="repeat"
              type="password"
              registration={form.register("repeat")}
              error={errors.repeat && t("settings.passwordMismatch")}
              autoComplete="new-password"
              disabled={submitting}
            />

            <Button variant="primary" type="submit" className="mt-2" disabled={submitting}>
              {t("invite.submit")}
            </Button>
          </form>
        )}
      </div>

      <Copyright className="absolute inset-x-0 bottom-4 text-center" />
    </div>
  );
}

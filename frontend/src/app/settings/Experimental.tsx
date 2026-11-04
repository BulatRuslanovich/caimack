// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useForm } from "react-hook-form";
import Link from "next/link";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/form";
import { SettingHelp } from "./SettingHelp";
import { Switch } from "@/components/ui/switch";
import { setYandexMusicEnabled, setYandexMusicToken } from "@/lib/yandexMusic";
import { useYandexMusicSettings } from "@/lib/useYandexMusic";
import { useT } from "@/contexts/I18nContext";
import { useToast } from "@/lib/useToast";
import { Panel } from "./Panel";

export function Experimental() {
  const t = useT();
  const { notify } = useToast();
  const yandex = useYandexMusicSettings();
  const form = useForm<{ token: string }>({ defaultValues: { token: "" } });

  const save = form.handleSubmit(({ token }) => {
    setYandexMusicToken(token);
    form.reset();
    notify(t("settings.yandexTokenSaved"), "success");
  });

  return (
    <Panel title={t("settings.experimental")}>
      <p className="max-w-xl text-sm text-muted-foreground">{t("settings.yandexIntro")}</p>
      <label className="flex cursor-pointer items-center gap-3">
        <Switch checked={yandex.enabled} onCheckedChange={setYandexMusicEnabled} />
        <span className="font-medium">
          <SettingHelp hint={t("settings.help.yandexMusic")}>
            {t("settings.yandexMusic")}
          </SettingHelp>
        </span>
      </label>

      {yandex.enabled && (
        <div className="flex flex-col gap-4 rounded-lg bg-card p-5 max-md:p-4">
          {yandex.hasToken && (
            <div className="flex flex-wrap items-center gap-3">
              <p role="status" className="flex flex-1 items-center gap-2 text-sm">
                <CheckIcon size={16} className="shrink-0 text-primary" />
                {t("settings.yandexConfigured")}
              </p>
              <Button asChild size="sm">
                <Link href="/search?tab=yandex">{t("yandex.findMusic")}</Link>
              </Button>
            </div>
          )}
          <form
            onSubmit={(event) => void save(event)}
            className="flex max-w-sm flex-col gap-3"
            noValidate
          >
            <TextField
              label={t("settings.yandexToken")}
              type="password"
              autoComplete="off"
              placeholder={yandex.hasToken ? "••••••••••••" : undefined}
              hint={t("settings.yandexTokenHint")}
              error={form.formState.errors.token?.message}
              registration={form.register("token", {
                validate: (value) => Boolean(value.trim()) || t("settings.yandexTokenRequired"),
              })}
            />

            <div className="flex items-center gap-5">
              <Button variant="primary" type="submit">
                {t("settings.yandexTokenSave")}
              </Button>
              {yandex.hasToken && (
                <Button
                  variant="text"
                  size="auto"
                  type="button"
                  onClick={() => setYandexMusicToken("")}
                >
                  {t("settings.yandexTokenForget")}
                </Button>
              )}
            </div>
          </form>
        </div>
      )}
    </Panel>
  );
}

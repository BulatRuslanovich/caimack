// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useForm } from "react-hook-form";
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
      <label className="flex cursor-pointer items-center gap-3">
        <Switch checked={yandex.enabled} onCheckedChange={setYandexMusicEnabled} />
        <span className="font-medium">
          <SettingHelp hint={t("settings.help.yandexMusic")}>
            {t("settings.yandexMusic")}
          </SettingHelp>
        </span>
      </label>

      {yandex.enabled && (
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
            registration={form.register("token", { required: true })}
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
      )}
    </Panel>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/form";
import { useT } from "@/contexts/I18nContext";
import { useToast } from "@/lib/useToast";
import { useYandexMusicSettings } from "./useYandexMusic";
import { setYandexMusicToken } from "./yandexMusic";
import { musicApi } from "../music";
import { YandexImportActivity } from "./YandexImports";

export function YandexMusicSettings() {
  const t = useT();
  const { notify } = useToast();
  const yandex = useYandexMusicSettings();
  const client = useQueryClient();
  const form = useForm<{ token: string }>({ defaultValues: { token: "" } });

  const save = form.handleSubmit(({ token }) => {
    setYandexMusicToken(token);
    form.reset();
    void client.invalidateQueries({ queryKey: ["music-sources"] });
    notify(t("settings.yandexTokenSaved"), "success");
  });

  return (
    <div className="grid gap-2">
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
              onClick={() => {
                setYandexMusicToken("");
                void client
                  .cancelQueries({ queryKey: ["music-sources"] })
                  .then(() => musicApi.forgetYandex())
                  .catch(() => notify(t("error.load"), "error"))
                  .finally(() => void client.invalidateQueries({ queryKey: ["music-sources"] }));
              }}
            >
              {t("settings.yandexTokenForget")}
            </Button>
          )}
        </div>
      </form>
      {yandex.enabled && (
        <div>
          <YandexImportActivity />
        </div>
      )}
    </div>
  );
}

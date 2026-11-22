// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import Link from "next/link";
import { SettingHelp } from "@/app/settings/SettingHelp";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/contexts/I18nContext";
import { setVkMusicEnabled, useVkMusicExperiment } from "./useVkMusicExperiment";

export function VkMusicSettings() {
  const t = useT();
  const enabled = useVkMusicExperiment();
  return (
    <>
      <label className="flex cursor-pointer items-center gap-3">
        <Switch checked={enabled} onCheckedChange={setVkMusicEnabled} />
        <span className="font-medium">
          <SettingHelp hint={t("settings.help.vkMusic")}>{t("settings.vkMusic")}</SettingHelp>
        </span>
      </label>
      {enabled && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-card p-5 max-md:p-4">
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t("vkMusic.startHint")}</p>
          <Button asChild size="sm">
            <Link href="/search?tab=vk">{t("vkMusic.findMusic")}</Link>
          </Button>
        </div>
      )}
    </>
  );
}

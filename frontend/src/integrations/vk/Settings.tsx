// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useT } from "@/contexts/I18nContext";
import { setVkMusicEnabled, useVkMusicExperiment } from "./useVkMusicExperiment";
import { ProviderSettings } from "../ui";

export function VkMusicSettings() {
  const t = useT();
  const enabled = useVkMusicExperiment();
  return (
    <ProviderSettings
      title={t("vkMusic.title")}
      description={t("settings.help.vkMusic")}
      enabled={enabled}
      onChange={setVkMusicEnabled}
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 basis-56 grow text-sm text-muted-foreground">
          {t("vkMusic.startHint")}
        </p>
        <Button asChild size="sm">
          <Link href="/search?tab=vk">{t("vkMusic.findMusic")}</Link>
        </Button>
      </div>
    </ProviderSettings>
  );
}

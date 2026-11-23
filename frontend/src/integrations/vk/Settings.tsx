// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useQuery } from "@tanstack/react-query";
import { useT } from "@/contexts/I18nContext";
import { VK_CONNECTION_QUERY, vkMusicConnection } from "./vkMusic";

export function VkMusicSettings() {
  const t = useT();
  const { data: status } = useQuery({
    queryKey: VK_CONNECTION_QUERY,
    queryFn: vkMusicConnection,
    enabled: false,
  });
  return (
    <p className="text-sm text-muted-foreground">
      {status && status !== "ready" ? t(`music.vk.${status}`) : t("vkMusic.startHint")}
    </p>
  );
}

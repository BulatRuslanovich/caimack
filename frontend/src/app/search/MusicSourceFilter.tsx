// SPDX-License-Identifier: AGPL-3.0-only

import Link from "next/link";
import { SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/contexts/I18nContext";
import { MusicSourceIcon } from "@/integrations/MusicSourceIcon";
import type { MusicSource } from "@/integrations/music";
import type { VkMusicConnection } from "@/integrations/vk/vkMusic";

export function MusicSourceFilter({
  sources,
  vkStatus,
  enabled,
  count,
  loading,
  failed,
  onToggle,
}: {
  sources: MusicSource[];
  vkStatus?: VkMusicConnection;
  enabled: (id: string) => boolean;
  count: number;
  loading: boolean;
  failed: boolean;
  onToggle: (id: string) => void;
}) {
  const t = useT();

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button className="min-h-11">
          <SlidersHorizontalIcon size={16} aria-hidden />
          {t("music.sourceFilter")}
          <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72 max-w-[calc(100vw-1.5rem)]">
        {loading && <DropdownMenuLabel>{t("common.loading")}</DropdownMenuLabel>}
        {failed && <DropdownMenuLabel>{t("error.load")}</DropdownMenuLabel>}
        {sources.map(({ id, name, status, audioStatus }) => {
          if (status === "ready") {
            return (
              <DropdownMenuCheckboxItem
                key={id}
                className="[&[data-state=checked]:not([data-highlighted])]:bg-transparent [&[data-state=checked]]:text-foreground"
                checked={enabled(id)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => onToggle(id)}
              >
                <MusicSourceIcon source={id} size={22} />
                <span className="truncate">{name ?? id}</span>
                {audioStatus === "missingExtractor" && (
                  <span
                    className="ml-auto shrink-0 text-xs text-muted-foreground"
                    title={t("music.status.missingExtractor")}
                  >
                    {t("music.searchOnly")}
                  </span>
                )}
              </DropdownMenuCheckboxItem>
            );
          }
          const shortStatus =
            status === "needsBrowser" && vkStatus && vkStatus !== "ready"
              ? t(`music.vkShort.${vkStatus}`)
              : t(`music.statusShort.${status}`);
          return (
            <DropdownMenuItem key={id} className="justify-between gap-4" asChild>
              <Link href="/settings?tab=music" title={t(`music.status.${status}`)}>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <MusicSourceIcon source={id} size={22} />
                  <span className="truncate">{name ?? id}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{shortStatus}</span>
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings?tab=music">{t("music.sourceSettings")}</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

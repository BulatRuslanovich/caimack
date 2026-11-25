// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { SlidersHorizontalIcon } from "lucide-react";
import { useT } from "@/contexts/I18nContext";
import { useTrackDisplay } from "@/lib/trackDisplay";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function TrackDisplayMenu() {
  const t = useT();
  const display = useTrackDisplay();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="max-md:hidden"
          data-active={display.showAudioSpec || display.showTempoKey}
        >
          <SlidersHorizontalIcon size={16} />
          {t("tracks.display")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={t("tracks.display")}>
        <DropdownMenuLabel>{t("tracks.details")}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={display.showAudioSpec}
          onCheckedChange={() => display.toggle("audio")}
          onSelect={(event) => event.preventDefault()}
        >
          {t("tracks.audioSpec")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={display.showTempoKey}
          onCheckedChange={() => display.toggle("tempo")}
          onSelect={(event) => event.preventDefault()}
        >
          {t("column.tempoKey")}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

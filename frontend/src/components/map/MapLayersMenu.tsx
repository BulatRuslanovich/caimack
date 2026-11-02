// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { CheckboxItem } from "@radix-ui/react-dropdown-menu";
import {
  ChevronDownIcon,
  ImageIcon,
  LayersIcon,
  OrbitIcon,
  PaletteIcon,
  RouteIcon,
  WaypointsIcon,
} from "lucide-react";
import { useT } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MAP_LAYERS, type MapLayer } from "./LibraryMapCanvas";

const LAYER_ICONS = {
  route: RouteIcon,
  covers: ImageIcon,
  links: WaypointsIcon,
  moods: PaletteIcon,
  motion: OrbitIcon,
};

export function MapLayersMenu({
  layers,
  onToggle,
}: {
  layers: ReadonlySet<MapLayer>;
  onToggle: (layer: MapLayer) => void;
}) {
  const t = useT();
  const count = MAP_LAYERS.filter((layer) => layer !== "motion" && layers.has(layer)).length;

  const item = (layer: MapLayer) => {
    const Icon = LAYER_ICONS[layer];
    return (
      <CheckboxItem
        key={layer}
        checked={layers.has(layer)}
        onCheckedChange={() => onToggle(layer)}
        onSelect={(event) => event.preventDefault()}
        className="group flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground"
      >
        <Icon size={16} className="shrink-0 text-muted-foreground" />
        <span className="flex-1">{t(`map.layer.${layer}`)}</span>
        <span
          aria-hidden="true"
          className="flex h-5 w-9 shrink-0 items-center rounded-full bg-border-strong p-0.5 transition-colors group-data-[state=checked]:bg-primary"
        >
          <span className="size-4 rounded-full bg-white shadow-sm transition-transform group-data-[state=checked]:translate-x-4" />
        </span>
      </CheckboxItem>
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="group pointer-coarse:min-h-11">
          <LayersIcon size={14} />
          {t("map.layersCount", { count })}
          <ChevronDownIcon
            size={14}
            className="text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64" aria-label={t("map.layers")}>
        <DropdownMenuLabel>{t("map.layers")}</DropdownMenuLabel>
        {MAP_LAYERS.filter((layer) => layer !== "motion").map(item)}
        <DropdownMenuSeparator />
        {item("motion")}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

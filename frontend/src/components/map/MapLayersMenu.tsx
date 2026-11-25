// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { CheckboxItem } from "@radix-ui/react-dropdown-menu";
import {
  ChevronDownIcon,
  ImageIcon,
  LayersIcon,
  OrbitIcon,
  RouteIcon,
  SparklesIcon,
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
  nebula: SparklesIcon,
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
        className="floating-item map-layer-item group min-h-11 gap-3"
      >
        <Icon size={16} className="shrink-0" />
        <span className="flex-1">{t(`map.layer.${layer}`)}</span>
        <span
          aria-hidden="true"
          className="flex h-5 w-8 shrink-0 items-center rounded-full bg-border-strong p-0.5 transition-colors group-data-[state=checked]:bg-primary motion-reduce:transition-none"
        >
          <span className="size-4 shrink-0 rounded-full bg-white shadow-sm transition-transform group-data-[state=checked]:translate-x-3 motion-reduce:transition-none" />
        </span>
      </CheckboxItem>
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="group">
          <LayersIcon size={14} />
          {t("map.layersCount", { count })}
          <ChevronDownIcon
            size={14}
            className="map-layers-chevron text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60 p-2" aria-label={t("map.layers")}>
        <DropdownMenuLabel className="px-3 pt-1.5 pb-2.5">{t("map.layers")}</DropdownMenuLabel>
        <div className="space-y-1">
          {MAP_LAYERS.filter((layer) => layer !== "motion").map(item)}
        </div>
        <DropdownMenuSeparator className="mx-3 my-2" />
        {item("motion")}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

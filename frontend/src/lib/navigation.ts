// SPDX-License-Identifier: AGPL-3.0-only

import type { Route } from "next";
import { audiobookCatalogHref } from "@/lib/audiobooks";
import type { TranslationKey } from "@/lib/i18n";
import {
  BookHeadphonesIcon,
  CopyIcon,
  DownloadIcon,
  HeartIcon,
  HistoryIcon,
  HouseIcon,
  LibraryBigIcon,
  MapIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UploadIcon,
  type LucideIcon,
} from "lucide-react";
import { isDesktop } from "@/desktop/runtime";

export interface NavEntry {
  href: Route;
  labelKey: TranslationKey;
  icon: LucideIcon;
}

const home: NavEntry = { href: "/", labelKey: "nav.home", icon: HouseIcon };
const search: NavEntry = { href: "/search", labelKey: "nav.search", icon: SearchIcon };
const favorites: NavEntry = { href: "/favorites", labelKey: "nav.favorites", icon: HeartIcon };
const map: NavEntry = { href: "/map", labelKey: "nav.map", icon: MapIcon };
const recent: NavEntry = {
  href: "/recently-played",
  labelKey: "nav.recentlyPlayed",
  icon: HistoryIcon,
};

const library = { href: "/library", labelKey: "nav.mediaLibrary", icon: LibraryBigIcon } as const;
const audiobooks = {
  href: audiobookCatalogHref,
  labelKey: "nav.audiobooks",
  icon: BookHeadphonesIcon,
} as const;

export function primaryNav(audiobooksEnabled: boolean): NavEntry[] {
  return audiobooksEnabled ? [home, search, library, audiobooks] : [home, search, library];
}

const downloads: NavEntry[] = isDesktop
  ? [{ href: "/downloads" as Route, labelKey: "nav.downloads", icon: DownloadIcon }]
  : [];

export const libraryNav: NavEntry[] = [favorites, recent, ...downloads, map];

export const libraryTabs: NavEntry[] = [library, ...libraryNav];

export function serviceNav(isAdmin: boolean): NavEntry[] {
  return [
    { href: "/settings", labelKey: "nav.settings", icon: SettingsIcon },
    ...(isAdmin
      ? ([
          { href: "/upload", labelKey: "nav.upload", icon: UploadIcon },
          { href: "/duplicates", labelKey: "nav.duplicates", icon: CopyIcon },
          { href: "/admin", labelKey: "nav.admin", icon: ShieldCheckIcon },
        ] as const)
      : []),
  ];
}

export function isActivePath(pathname: string, href: string): boolean {
  const path = href.split(/[?#]/, 1)[0];
  return path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);
}

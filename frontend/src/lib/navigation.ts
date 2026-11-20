// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { Route } from "next";
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
  href: "/audiobooks",
  labelKey: "nav.audiobooks",
  icon: BookHeadphonesIcon,
} as const;

export const primaryNav: NavEntry[] = [home, search, library, audiobooks];

const downloads: NavEntry[] = isDesktop
  ? [{ href: "/downloads" as Route, labelKey: "nav.downloads", icon: DownloadIcon }]
  : [];

export const libraryNav: NavEntry[] = [favorites, recent, ...downloads, map];

export const mobileNav: NavEntry[] = [home, search, library, audiobooks];

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
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

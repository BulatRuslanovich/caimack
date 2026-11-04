// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { Route } from "next";
import type { TranslationKey } from "@/lib/i18n";
import {
  AudioLinesIcon,
  CopyIcon,
  Disc3Icon,
  HeartIcon,
  HistoryIcon,
  HouseIcon,
  LibraryBigIcon,
  ListMusicIcon,
  MapIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TagsIcon,
  UploadIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";

export interface NavEntry {
  href: Route;
  labelKey: TranslationKey;
  icon: LucideIcon;
}

const home: NavEntry = { href: "/", labelKey: "nav.home", icon: HouseIcon };
const search: NavEntry = { href: "/search", labelKey: "nav.search", icon: SearchIcon };
const tracks: NavEntry = { href: "/tracks", labelKey: "nav.tracks", icon: AudioLinesIcon };
const playlists: NavEntry = { href: "/playlists", labelKey: "nav.playlists", icon: ListMusicIcon };
const favorites: NavEntry = { href: "/favorites", labelKey: "nav.favorites", icon: HeartIcon };
const albums: NavEntry = { href: "/albums", labelKey: "nav.albums", icon: Disc3Icon };
const artists: NavEntry = { href: "/artists", labelKey: "nav.artists", icon: UsersRoundIcon };
const genres: NavEntry = { href: "/genres", labelKey: "nav.genres", icon: TagsIcon };
const map: NavEntry = { href: "/map", labelKey: "nav.map", icon: MapIcon };
const recent: NavEntry = {
  href: "/recently-played",
  labelKey: "nav.recentlyPlayed",
  icon: HistoryIcon,
};

export const primaryNav: NavEntry[] = [home, search, tracks, playlists];

export const libraryNav: NavEntry[] = [favorites, albums, artists, genres, map, recent];

export const mobileNav: NavEntry[] = [
  home,
  search,
  { href: "/playlists", labelKey: "nav.mediaLibrary", icon: LibraryBigIcon },
];

export const libraryTabs: NavEntry[] = [
  playlists,
  albums,
  artists,
  tracks,
  favorites,
  recent,
  genres,
  map,
];

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

// SPDX-License-Identifier: AGPL-3.0-only

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
const tracks = { href: "/tracks", labelKey: "nav.tracks", icon: AudioLinesIcon } as const;
const playlists = { href: "/playlists", labelKey: "nav.playlists", icon: ListMusicIcon } as const;
const favorites: NavEntry = { href: "/favorites", labelKey: "nav.favorites", icon: HeartIcon };
const albums = { href: "/albums", labelKey: "nav.albums", icon: Disc3Icon } as const;
const artists = { href: "/artists", labelKey: "nav.artists", icon: UsersRoundIcon } as const;
const genres = { href: "/genres", labelKey: "nav.genres", icon: TagsIcon } as const;
const map: NavEntry = { href: "/map", labelKey: "nav.map", icon: MapIcon };
const recent: NavEntry = {
  href: "/recently-played",
  labelKey: "nav.recentlyPlayed",
  icon: HistoryIcon,
};

const library = { href: "/library", labelKey: "nav.mediaLibrary", icon: LibraryBigIcon } as const;

export const primaryNav: NavEntry[] = [home, search, library];

export const libraryNav: NavEntry[] = [favorites, recent, map];

export const catalogNav = [tracks, albums, artists, playlists, genres] satisfies NavEntry[];

export type LibraryBrowsePath = typeof library.href | (typeof catalogNav)[number]["href"];

export function isLibraryBrowsePath(pathname: string): pathname is LibraryBrowsePath {
  return pathname === library.href || catalogNav.some(({ href }) => href === pathname);
}

export const mobileNav: NavEntry[] = [home, search, library];

export const libraryTabs: NavEntry[] = [
  library,
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

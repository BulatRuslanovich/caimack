// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { MetadataRoute } from "next";
import { DEFAULT_COLORWAY, THEME_COLORS } from "@/lib/themeScript";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Caimack",
    short_name: "Caimack",
    description: "A personal, music streaming library.",
    start_url: "/",
    display: "standalone",
    background_color: THEME_COLORS[DEFAULT_COLORWAY].dark,
    theme_color: THEME_COLORS[DEFAULT_COLORWAY].dark,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

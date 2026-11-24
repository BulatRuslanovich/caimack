// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { LibraryMapPage } from "@/app/map/LibraryMapPage";
import { lazy } from "react";

const LibraryMapGalaxy = lazy(() =>
  import("@/components/map/LibraryMapGalaxy").then((module) => ({
    default: module.LibraryMapGalaxy,
  })),
);

export default function Page() {
  return <LibraryMapPage Galaxy={LibraryMapGalaxy} />;
}

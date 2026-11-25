// SPDX-License-Identifier: AGPL-3.0-only

import { isDesktop } from "@/desktop/runtime";
import type { MapProjection } from "./types";

let webGlAvailable: boolean | undefined;

export function defaultMapProjection(): MapProjection {
  if (isDesktop || typeof document === "undefined") return "2d";
  if (webGlAvailable === undefined) {
    try {
      const context = document.createElement("canvas").getContext("webgl2");
      webGlAvailable = context !== null;
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webGlAvailable = false;
    }
  }
  return webGlAvailable ? "3d" : "2d";
}

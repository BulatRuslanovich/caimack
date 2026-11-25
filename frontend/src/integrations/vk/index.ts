// SPDX-License-Identifier: AGPL-3.0-only

import { MusicBrowserRuntime } from "./MusicBrowserRuntime";

import dynamic from "next/dynamic";
import type { IntegrationModule } from "../types";

export const integration: IntegrationModule = {
  webOnly: true,
  Settings: dynamic(() => import("./Settings").then((module) => module.VkMusicSettings)),
  Runtime: MusicBrowserRuntime,
};

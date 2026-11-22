// SPDX-License-Identifier: AGPL-3.0-only

import dynamic from "next/dynamic";
import type { IntegrationModule } from "../types";
import { subscribeVkMusicExperiment, vkMusicEnabled } from "./useVkMusicExperiment";

export const integration: IntegrationModule = {
  webOnly: true,
  preference: { read: vkMusicEnabled, subscribe: subscribeVkMusicExperiment },
  Settings: dynamic(() => import("./Settings").then((module) => module.VkMusicSettings)),
  search: {
    label: "vkMusic.title",
    Workspace: dynamic(() => import("./VkMusicSearch").then((module) => module.VkMusicSearch)),
  },
};

// SPDX-License-Identifier: AGPL-3.0-only

import dynamic from "next/dynamic";
import { type ReactNode } from "react";
import type { IntegrationModule } from "../types";
import { YandexMusicProvider } from "./YandexMusicContext";

function Runtime({ children, available }: { children: ReactNode; available: boolean }) {
  return <YandexMusicProvider available={available}>{children}</YandexMusicProvider>;
}

export const integration: IntegrationModule = {
  Settings: dynamic(() => import("./Settings").then((module) => module.YandexMusicSettings)),
  Runtime,
};

// SPDX-License-Identifier: AGPL-3.0-only

import dynamic from "next/dynamic";
import { type ReactNode } from "react";
import type { IntegrationModule } from "../types";
import { YandexMusicProvider } from "./YandexMusicContext";
import { subscribeYandexMusic, yandexMusicEnabled } from "./yandexMusic";

function Runtime({ children, available }: { children: ReactNode; available: boolean }) {
  return <YandexMusicProvider available={available}>{children}</YandexMusicProvider>;
}

export const integration: IntegrationModule = {
  preference: { read: yandexMusicEnabled, subscribe: subscribeYandexMusic },
  Settings: dynamic(() => import("./Settings").then((module) => module.YandexMusicSettings)),
  Runtime,
  search: {
    label: "yandex.title",
    placeholder: "yandex.searchPlaceholder",
    Workspace: dynamic(() =>
      import("./YandexSearchWorkspace").then((module) => module.YandexSearchWorkspace),
    ),
  },
};

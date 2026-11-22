// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentType, ReactNode } from "react";
import type { TranslationKey } from "@/lib/i18n";

export interface IntegrationModule {
  webOnly?: boolean;
  preference: {
    read: () => boolean;
    subscribe: (listener: () => void) => () => void;
  };
  Settings: ComponentType;
  Runtime?: ComponentType<{ children: ReactNode; available: boolean }>;
  search: {
    label: TranslationKey;
    placeholder?: TranslationKey;
    Workspace: ComponentType<{ query: string; onChange: (query: string) => void }>;
  };
}

export interface Integration extends IntegrationModule {
  id: string;
}

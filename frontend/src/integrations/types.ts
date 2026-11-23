// SPDX-License-Identifier: AGPL-3.0-only

import type { ComponentType, ReactNode } from "react";

export interface IntegrationModule {
  webOnly?: boolean;
  Settings: ComponentType;
  Runtime?: ComponentType<{ children: ReactNode; available: boolean }>;
}

export interface Integration extends IntegrationModule {
  id: string;
}

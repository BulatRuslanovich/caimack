// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { LucideProvider } from "lucide-react";
import { AuthProvider } from "@/contexts/AuthContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { PlayerUiProvider } from "@/contexts/PlayerUiContext";
import { UploadProvider } from "@/contexts/UploadContext";
import { IntegrationRuntime } from "@/integrations/registry";
import type { Dictionary, Locale } from "@/lib/i18n";
import type { User } from "@/lib/types";
import type { ReactNode } from "react";
import { AppShell } from "./AppShell";
import { QueryProvider } from "./QueryProvider";
import { Toaster } from "./ui/sonner";

export function Application({
  children,
  initialUser,
  initialLocale,
  initialDictionary,
}: {
  children: ReactNode;
  initialUser: User | null;
  initialLocale: Locale;
  initialDictionary: Dictionary;
}) {
  return (
    <LucideProvider size={20} strokeWidth={2} absoluteStrokeWidth>
      <I18nProvider initialLocale={initialLocale} initialDictionary={initialDictionary}>
        <QueryProvider>
          <AuthProvider initialUser={initialUser}>
            <PlayerProvider>
              <UploadProvider>
                <PlayerUiProvider>
                  <IntegrationRuntime>
                    <AppShell>{children}</AppShell>
                  </IntegrationRuntime>
                </PlayerUiProvider>
              </UploadProvider>
            </PlayerProvider>
          </AuthProvider>
        </QueryProvider>
        <Toaster />
      </I18nProvider>
    </LucideProvider>
  );
}

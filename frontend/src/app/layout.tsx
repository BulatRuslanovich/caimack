// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

import type { Metadata, Viewport } from "next";
import { Onest, Unbounded } from "next/font/google";
import { cookies } from "next/headers";
import { LucideProvider } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { QueryProvider } from "@/components/QueryProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { PlayerProvider } from "@/contexts/PlayerContext";
import { PlayerUiProvider } from "@/contexts/PlayerUiContext";
import { YandexMusicProvider } from "@/contexts/YandexMusicContext";
import { Toaster } from "@/components/ui/sonner";
import { UploadProvider } from "@/contexts/UploadContext";
import { EARLY_FETCH_SCRIPT, SESSION_HINT_COOKIE } from "@/lib/earlyFetch";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, loadDictionary } from "@/lib/i18n";
import { parseSessionHint } from "@/lib/session/sessionHint";
import { DEFAULT_COLORWAY, NO_FLASH_THEME_SCRIPT, THEME_COLORS } from "@/lib/themeScript";
import "./globals.css";
import { ReactNode } from "react";

const onest = Onest({
  subsets: ["latin", "cyrillic"],
  variable: "--font-onest",
  display: "swap",
});

const unbounded = Unbounded({
  subsets: ["latin", "cyrillic"],
  weight: ["500"],
  variable: "--font-unbounded",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Caimack",
  description: "A personal, music streaming library.",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    title: "Caimack",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: THEME_COLORS[DEFAULT_COLORWAY].dark,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const initialUser = parseSessionHint(jar.get(SESSION_HINT_COOKIE)?.value);

  const cookieLocale = jar.get(LOCALE_COOKIE)?.value;
  const initialLocale = cookieLocale && isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;
  const initialDictionary = await loadDictionary(initialLocale);

  return (
    <html
      lang={initialLocale}
      className={`${onest.variable} ${unbounded.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: EARLY_FETCH_SCRIPT }} />
      </head>
      <body>
        <LucideProvider size={20} strokeWidth={2} absoluteStrokeWidth>
          <I18nProvider initialLocale={initialLocale} initialDictionary={initialDictionary}>
            <QueryProvider>
              <AuthProvider initialUser={initialUser}>
                <PlayerProvider>
                  <UploadProvider>
                    <PlayerUiProvider>
                      <YandexMusicProvider>
                        <AppShell>{children}</AppShell>
                      </YandexMusicProvider>
                    </PlayerUiProvider>
                  </UploadProvider>
                </PlayerProvider>
              </AuthProvider>
            </QueryProvider>
            <Toaster />
          </I18nProvider>
        </LucideProvider>
      </body>
    </html>
  );
}

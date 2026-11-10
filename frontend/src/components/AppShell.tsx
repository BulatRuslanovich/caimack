// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/contexts/I18nContext";
import { usePlayerUi } from "@/contexts/PlayerUiContext";
import { useLibraryDensity } from "@/lib/libraryDensity";
import { isTypingTarget } from "@/lib/shortcuts";
import { signConsole } from "@/lib/signature";
import { useRecommendations } from "@/lib/useRecommendations";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { LeanBack } from "./LeanBack";
import { Loading } from "./Loading";
import { LibraryChips, MobileHeader, MobileNav } from "./MobileNav";
import { NowPlayingTone } from "./NowPlayingTone";
import { Player } from "./Player";
import { SecretCat } from "./SecretCat";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { Sidebar } from "./Sidebar";
import { YandexImports } from "./yandex/YandexImports";
const QueuePanel = dynamic(() => import("./QueuePanel").then((m) => m.QueuePanel), { ssr: false });

export function AppShell({ children }: { children: ReactNode }) {
  useLibraryDensity();
  const recommendations = useRecommendations();
  const { user, loading } = useAuth();
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const { queueOpen, queueDocked, setQueueOpen } = usePlayerUi();

  const isLoginPage = pathname === "/login";
  const isPublicPage = isLoginPage || pathname.startsWith("/invite/");

  useEffect(() => signConsole(), []);

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublicPage) router.replace("/login");
    if (user && isLoginPage) router.replace("/");
  }, [loading, user, isLoginPage, isPublicPage, router]);

  useEffect(() => {
    if (!user) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const slash = event.key === "/" || (event.code === "Slash" && !event.shiftKey);
      if (!slash || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector("[data-state='open']:is([role='dialog'], [role='menu'])")) return;

      event.preventDefault();

      const field = document.querySelector<HTMLInputElement>('#content input[type="search"]');
      if (pathname === "/search" && field) field.focus();
      else router.push("/search");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [user, pathname, router]);

  if (isPublicPage) return <>{children}</>;

  if (loading) return <Loading size="l" label={t("common.loadingLibrary")} />;

  if (!user) return null;

  return (
    <div
      data-queue-docked={queueDocked}
      className="app-shell grid h-dvh grid-cols-[var(--sidebar-width)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] [grid-template-areas:'sidebar_content''player_player'] max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)_auto_auto] max-md:[grid-template-areas:'mobile-header''content''player''nav']"
    >
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-100 focus:rounded-md focus:bg-popover focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-pop"
      >
        {t("nav.skipToContent")}
      </a>

      <Sidebar />
      <MobileHeader />

      <main
        id="content"
        tabIndex={-1}
        className="relative isolate overflow-y-auto overscroll-contain outline-none [grid-area:content]"
      >
        <div aria-hidden="true" className="ambient-glow" />
        <div className="mx-auto flex min-h-full max-w-[90rem] flex-col gap-11 px-10 pt-8 pb-12 max-lg:px-6 max-md:gap-8 max-md:px-4 max-md:pt-5 max-md:pb-8">
          <LibraryChips />
          {((!["/map", "/recap"].includes(pathname) && !pathname.startsWith("/mixes/")) ||
            recommendations) &&
            children}
        </div>
      </main>

      {queueOpen && <QueuePanel docked={queueDocked} onClose={() => setQueueOpen(false)} />}

      <div className="flex flex-col [grid-area:player]">
        <Player />
      </div>
      <MobileNav />
      <NowPlayingTone />
      <ShortcutsHelp />
      <LeanBack />
      <SecretCat />
      <YandexImports />
    </div>
  );
}

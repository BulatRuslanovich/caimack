// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useRecommendations } from "@/lib/useRecommendations";
import Link from "next/link";
import type { Route } from "next";
import { isDesktop } from "@/desktop/api";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  AudioLinesIcon,
  ChartLineIcon,
  FlaskConicalIcon,
  ListMusicIcon,
  PaletteIcon,
  RadioIcon,
  UserRoundIcon,
} from "lucide-react";
import { AppVersion } from "@/components/AppVersion";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/contexts/I18nContext";
import { RecommendationStats } from "./RecommendationStats";
import { Appearance } from "./Appearance";
import { Playback } from "./Playback";
import { Experimental } from "./Experimental";
import { MusicSources } from "./MusicSources";
import { Account } from "./Account";
import { ListeningStats } from "./ListeningStats";

export default function SettingsPage() {
  const t = useT();

  return (
    <>
      <PageHeader title={t("settings.title")} />
      <Suspense fallback={null}>
        <SettingsSections />
      </Suspense>
      {isDesktop && (
        <Link href={"/downloads" as Route} className="text-sm text-primary">
          {t("nav.downloads")}
        </Link>
      )}
    </>
  );
}

type SettingsSection =
  | "playback"
  | "appearance"
  | "listening"
  | "recommendations"
  | "account"
  | "experimental"
  | "music";

const SECTIONS: SettingsSection[] = [
  "playback",
  "appearance",
  "listening",
  "recommendations",
  "account",
];

const ADMIN_SECTIONS: SettingsSection[] = [...SECTIONS, "music", "experimental"];

const DEFAULT_SECTION: SettingsSection = "playback";

const SECTION_ICONS = {
  playback: AudioLinesIcon,
  appearance: PaletteIcon,
  listening: ChartLineIcon,
  recommendations: RadioIcon,
  account: UserRoundIcon,
  experimental: FlaskConicalIcon,
  music: ListMusicIcon,
};

function SettingsSections() {
  const t = useT();
  const params = useSearchParams();
  const { isAdmin } = useAuth();
  const recommendations = useRecommendations();
  const sections = (isAdmin ? ADMIN_SECTIONS : SECTIONS).filter(
    (key) => key !== "recommendations" || recommendations,
  );

  const raw = params.get("tab");
  const section = sections.find((key) => key === raw) ?? DEFAULT_SECTION;

  return (
    <div className="settings-workspace">
      <div className="settings-sidebar">
        <nav aria-label={t("settings.title")} className="settings-navigation">
          {sections.map((key) => {
            const Icon = SECTION_ICONS[key];
            return (
              <Link
                key={key}
                href={key === DEFAULT_SECTION ? "/settings" : `/settings?tab=${key}`}
                replace
                scroll={false}
                prefetch={false}
                aria-current={section === key ? "page" : undefined}
                onNavigate={(event) => {
                  event.preventDefault();
                  window.history.replaceState(
                    null,
                    "",
                    key === DEFAULT_SECTION ? "/settings" : `/settings?tab=${key}`,
                  );
                }}
              >
                <Icon size={18} aria-hidden="true" />
                {t(`settings.${key}`)}
              </Link>
            );
          })}
        </nav>
        <AppVersion className="mt-4 px-3 text-left" />
      </div>

      <div className="settings-content">
        {section === "playback" && <Playback />}
        {section === "appearance" && <Appearance />}
        {section === "listening" && <ListeningStats />}
        {section === "recommendations" && <RecommendationStats />}
        {section === "account" && <Account />}
        {section === "music" && <MusicSources />}
        {section === "experimental" && <Experimental />}
      </div>
    </div>
  );
}

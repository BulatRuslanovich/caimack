// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import {
  AudioLinesIcon,
  FlaskConicalIcon,
  PaletteIcon,
  RadioIcon,
  UserRoundIcon,
} from "lucide-react";
import { Copyright } from "@/components/Copyright";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/contexts/AuthContext";
import { useT } from "@/contexts/I18nContext";
import { RecommendationStats } from "./RecommendationStats";
import { Appearance } from "./Appearance";
import { Playback } from "./Playback";
import { Experimental } from "./Experimental";
import { Account } from "./Account";

export default function SettingsPage() {
  const t = useT();

  return (
    <>
      <PageHeader title={t("settings.title")} />
      <Suspense fallback={null}>
        <SettingsSections />
      </Suspense>
      <Copyright className="mt-auto" />
    </>
  );
}

type SettingsSection = "playback" | "appearance" | "recommendations" | "account" | "experimental";

const SECTIONS: SettingsSection[] = ["playback", "appearance", "recommendations", "account"];

const ADMIN_SECTIONS: SettingsSection[] = [...SECTIONS, "experimental"];

const DEFAULT_SECTION: SettingsSection = "playback";

const SECTION_ICONS = {
  playback: AudioLinesIcon,
  appearance: PaletteIcon,
  recommendations: RadioIcon,
  account: UserRoundIcon,
  experimental: FlaskConicalIcon,
};

function SettingsSections() {
  const t = useT();
  const params = useSearchParams();
  const { isAdmin } = useAuth();
  const sections = isAdmin ? ADMIN_SECTIONS : SECTIONS;

  const raw = params.get("tab");
  const section = sections.find((key) => key === raw) ?? DEFAULT_SECTION;
  const navigation = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    const revealCurrent = () => {
      const current = nav.querySelector('[aria-current="page"]');
      if (!current || nav.scrollWidth <= nav.clientWidth) return;
      const outer = nav.getBoundingClientRect();
      const inner = current.getBoundingClientRect();
      if (inner.left < outer.left) nav.scrollLeft += inner.left - outer.left;
      else if (inner.right > outer.right) nav.scrollLeft += inner.right - outer.right;
    };
    const observer = new ResizeObserver(revealCurrent);
    observer.observe(nav);
    revealCurrent();
    return () => observer.disconnect();
  }, [section]);

  return (
    <div className="settings-workspace">
      <nav ref={navigation} aria-label={t("settings.title")} className="settings-navigation">
        {sections.map((key) => {
          const Icon = SECTION_ICONS[key];
          return (
            <Link
              key={key}
              href={key === DEFAULT_SECTION ? "/settings" : `/settings?tab=${key}`}
              replace
              scroll={false}
              aria-current={section === key ? "page" : undefined}
            >
              <Icon size={18} aria-hidden="true" />
              {t(`settings.${key}`)}
            </Link>
          );
        })}
      </nav>

      <div className="settings-content">
        {section === "playback" && <Playback />}
        {section === "appearance" && <Appearance />}
        {section === "recommendations" && <RecommendationStats />}
        {section === "account" && <Account />}
        {section === "experimental" && <Experimental />}
      </div>
    </div>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { LOCALES, LOCALE_NAMES } from "@/lib/i18n";
import {
  setColorway,
  setCoverTone,
  setTheme,
  THEME_CHOICES,
  useColorway,
  useCoverToneEnabled,
  useTheme,
  useThemeChoice,
} from "@/lib/theme";
import { COLORWAYS } from "@/lib/themeScript";
import { leanBack, useLeanBack } from "@/lib/leanBack";
import { setVisualizer, useVisualizer } from "@/lib/visualizer";
import { LIBRARY_DENSITIES, setLibraryDensity, useLibraryDensity } from "@/lib/libraryDensity";
import { SettingHelp } from "./SettingHelp";
import { Switch } from "@/components/ui/switch";
import { useI18n, useT } from "@/contexts/I18nContext";
import { ColorwaySwatch, ThemeSwatch } from "./ThemeSwatch";
import { Choice, Panel } from "./Panel";

export function Appearance() {
  const t = useT();
  const { locale, setLocale } = useI18n();
  const theme = useThemeChoice();
  const palette = useTheme();
  const colorway = useColorway();
  const leanBackState = useLeanBack();
  const visualizer = useVisualizer();
  const coverTone = useCoverToneEnabled();
  const density = useLibraryDensity();

  return (
    <Panel title={t("settings.appearance")}>
      <Choice
        legend={<SettingHelp hint={t("settings.help.theme")}>{t("settings.theme")}</SettingHelp>}
        value={theme}
        onChange={setTheme}
        options={THEME_CHOICES.map((value) => ({
          value,
          label: t(`settings.theme.${value}`),
          preview: <ThemeSwatch choice={value} colorway={colorway} />,
        }))}
      />

      <Choice
        legend={
          <SettingHelp hint={t("settings.help.colorway")}>{t("settings.colorway")}</SettingHelp>
        }
        value={colorway}
        onChange={setColorway}
        options={COLORWAYS.map((value) => ({
          value,
          label: t(`settings.colorway.${value}`),
          preview: <ColorwaySwatch colorway={value} palette={palette} />,
        }))}
      />

      <Choice
        legend={
          <SettingHelp hint={t("settings.help.language")}>{t("settings.language")}</SettingHelp>
        }
        value={locale}
        onChange={setLocale}
        options={LOCALES.map((value) => ({ value, label: LOCALE_NAMES[value] }))}
      />

      <Choice
        legend={t("library.density")}
        value={density}
        onChange={setLibraryDensity}
        options={LIBRARY_DENSITIES.map((value) => ({
          value,
          label: t(`library.density.${value}`),
        }))}
      />

      <label className="flex cursor-pointer items-center gap-3">
        <Switch checked={coverTone} onCheckedChange={setCoverTone} />
        <span className="font-medium">
          <SettingHelp hint={t("settings.help.coverTone")}>{t("settings.coverTone")}</SettingHelp>
        </span>
      </label>

      <label className="flex cursor-pointer items-center gap-3">
        <Switch checked={visualizer} onCheckedChange={setVisualizer} />
        <span className="font-medium">
          <SettingHelp hint={t("settings.help.visualizer")}>{t("settings.visualizer")}</SettingHelp>
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-3 pointer-coarse:hidden">
        <Switch
          checked={leanBackState.auto}
          onCheckedChange={leanBack.setAuto}
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">
            <SettingHelp hint={t("settings.help.leanBack")}>{t("settings.leanBack")}</SettingHelp>
          </span>
        </span>
      </label>
    </Panel>
  );
}

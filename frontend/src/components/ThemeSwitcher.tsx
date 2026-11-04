// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useT } from "@/contexts/I18nContext";
import { setTheme, useTheme } from "@/lib/theme";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "./ui/button";

export function ThemeSwitcher() {
  const t = useT();
  const theme = useTheme();
  const label = t("action.switchTheme");

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      aria-label={label}
      title={label}
    >
      {theme === "light" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
    </Button>
  );
}

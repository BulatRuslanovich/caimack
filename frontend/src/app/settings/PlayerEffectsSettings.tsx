// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useId } from "react";
import { useT } from "@/contexts/I18nContext";
import {
  PLAYER_EFFECTS,
  setPlayerEffects,
  usePlayerEffects,
  type PlayerEffectChoice,
} from "@/lib/playerEffects";
import { Choice } from "./Panel";
import { SettingHelp } from "./SettingHelp";

export function PlayerEffectsSettings() {
  const t = useT();
  const state = usePlayerEffects();
  const intensityId = useId();

  return (
    <div className="player-effects-settings flex flex-col gap-5">
      <Choice<PlayerEffectChoice>
        legend={<SettingHelp hint={t("effects.settingsHint")}>{t("effects.title")}</SettingHelp>}
        value={state.effect}
        onChange={(effect) => setPlayerEffects({ effect })}
        options={(["off", ...PLAYER_EFFECTS] as const).map((effect) => ({
          value: effect,
          label: t(`effects.${effect}`),
          preview: (
            <span
              aria-hidden="true"
              className="player-effect-preview mb-1 block h-10 w-full"
              data-effect={effect}
            />
          ),
        }))}
      />
      <div className="flex max-w-md flex-col gap-2">
        <label htmlFor={intensityId} className="flex items-center justify-between gap-3 text-sm">
          <span>{t("effects.intensity")}</span>
          <output htmlFor={intensityId} className="text-muted-foreground tabular-nums">
            {Math.round(state.intensity)}%
          </output>
        </label>
        <input
          id={intensityId}
          type="range"
          min="0"
          max="100"
          step="1"
          value={state.intensity}
          aria-valuetext={`${Math.round(state.intensity)}%`}
          disabled={state.effect === "off"}
          className="h-9 w-full cursor-ew-resize accent-primary disabled:cursor-default disabled:opacity-40"
          onChange={(event) => setPlayerEffects({ intensity: Number(event.target.value) })}
        />
      </div>
      <div className="flex max-w-md flex-col gap-2">
        <label
          htmlFor={`${intensityId}-sensitivity`}
          className="flex items-center justify-between gap-3 text-sm"
        >
          <span>{t("effects.sensitivity")}</span>
          <output
            htmlFor={`${intensityId}-sensitivity`}
            className="text-muted-foreground tabular-nums"
          >
            {Math.round(state.sensitivity)}%
          </output>
        </label>
        <input
          id={`${intensityId}-sensitivity`}
          type="range"
          min="0"
          max="100"
          step="1"
          value={state.sensitivity}
          aria-valuetext={`${Math.round(state.sensitivity)}%`}
          disabled={state.effect === "off"}
          className="h-9 w-full cursor-ew-resize accent-primary disabled:cursor-default disabled:opacity-40"
          onChange={(event) => setPlayerEffects({ sensitivity: Number(event.target.value) })}
        />
        <p className="text-xs text-muted-foreground">{t("effects.sensitivityHint")}</p>
      </div>
    </div>
  );
}

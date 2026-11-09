// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useId } from "react";
import { useT } from "@/contexts/I18nContext";
import {
  PLAYER_EFFECTS,
  PLAYER_EFFECT_LEVELS,
  playerEffectLevel,
  setPlayerEffects,
  usePlayerEffects,
  type PlayerEffectChoice,
} from "@/lib/playerEffects";
import { Choice } from "./Panel";
import { SettingHelp } from "./SettingHelp";

function EffectLevelSlider({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const t = useT();
  const level = playerEffectLevel(value);
  return (
    <>
      <label htmlFor={id} className="flex items-center justify-between gap-3 text-sm">
        <span>{label}</span>
        <output htmlFor={id} className="text-muted-foreground tabular-nums">
          {level} / 5
        </output>
      </label>
      <input
        id={id}
        type="range"
        min="1"
        max="5"
        step="1"
        value={level}
        aria-valuetext={t("effects.level", { level })}
        disabled={disabled}
        className="h-9 w-full cursor-ew-resize accent-primary disabled:cursor-default disabled:opacity-40"
        onChange={(event) => onChange(PLAYER_EFFECT_LEVELS[Number(event.target.value) - 1])}
      />
      <div
        aria-hidden="true"
        className={`mx-2 -mt-2 flex justify-between text-xs tabular-nums ${disabled ? "opacity-40" : ""}`}
      >
        {PLAYER_EFFECT_LEVELS.map((_, index) => (
          <span
            key={index}
            className={`flex flex-col items-center gap-1 ${index + 1 === level ? "text-foreground" : "text-muted-foreground"}`}
          >
            <span className="h-1 w-px bg-current" />
            {index + 1}
          </span>
        ))}
      </div>
    </>
  );
}

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
        <EffectLevelSlider
          id={intensityId}
          label={t("effects.intensity")}
          value={state.intensity}
          disabled={state.effect === "off"}
          onChange={(intensity) => setPlayerEffects({ intensity })}
        />
      </div>
      <div className="flex max-w-md flex-col gap-2">
        <EffectLevelSlider
          id={`${intensityId}-sensitivity`}
          label={t("effects.sensitivity")}
          value={state.sensitivity}
          disabled={state.effect === "off"}
          onChange={(sensitivity) => setPlayerEffects({ sensitivity })}
        />
        <p className="text-xs text-muted-foreground">{t("effects.sensitivityHint")}</p>
      </div>
    </div>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { useId, useState } from "react";
import { CROSSFADE_CHOICES } from "@/lib/playback/crossfade";
import {
  EQ_BANDS,
  EQ_LIMIT_DB,
  EQ_PRESETS,
  type EqualizerPreset,
  useEqualizer,
} from "@/lib/playback/equalizer";
import { cn } from "@/lib/cn";
import { SettingHelp } from "./SettingHelp";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/lib/useSettings";
import { useI18n, useT } from "@/contexts/I18nContext";
import { usePlayer } from "@/contexts/PlayerContext";
import type { AudioQuality } from "@/lib/types";
import { Choice, Panel } from "./Panel";
import { PlaybackDevices } from "@/components/PlaybackDevices";
import { useConnect } from "@/lib/playback/useConnectPlayback";

const QUALITIES: { quality: AudioQuality; bitrateKbps: number | null }[] = [
  { quality: "Low", bitrateKbps: 64 },
  { quality: "Normal", bitrateKbps: 128 },
  { quality: "Original", bitrateKbps: null },
];

export function Playback() {
  const t = useT();
  const settings = useSettings();
  const connect = useConnect();
  const supportsCrossfade =
    !connect.selectedId ||
    connect.devices.find((device) => device.id === connect.selectedId)?.kind !== "android";
  const {
    crossfade,
    setCrossfade,
    smartTransitions,
    setSmartTransitions,
    normalizeVolume,
    setNormalizeVolume,
  } = usePlayer();

  return (
    <Panel title={t("settings.playback")}>
      <PlaybackDevices />
      <Choice
        legend={
          <SettingHelp hint={t("settings.help.quality")}>{t("settings.quality")}</SettingHelp>
        }
        value={settings.quality}
        onChange={(quality) => settings.update({ quality })}
        options={QUALITIES.map(({ quality, bitrateKbps }) => ({
          value: quality,
          label: t(`settings.quality.${quality}`),
          hint: bitrateKbps
            ? t("settings.qualityBitrate", { bitrate: bitrateKbps })
            : t("settings.qualityOriginal"),
        }))}
      />

      {supportsCrossfade && (
        <Choice
          legend={
            <SettingHelp hint={t("settings.help.crossfade")}>{t("settings.crossfade")}</SettingHelp>
          }
          value={String(crossfade)}
          onChange={(seconds) => setCrossfade(Number(seconds))}
          options={CROSSFADE_CHOICES.map((seconds) => ({
            value: String(seconds),
            label: seconds
              ? t("settings.crossfadeSeconds", { seconds })
              : t("settings.crossfadeOff"),
          }))}
        />
      )}

      <label className="flex cursor-pointer items-start gap-3">
        <Switch
          checked={smartTransitions}
          onCheckedChange={setSmartTransitions}
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">
            <SettingHelp hint={t("settings.help.smartTransitions")}>
              {t("settings.smartTransitions")}
            </SettingHelp>
          </span>
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-3">
        <Switch checked={normalizeVolume} onCheckedChange={setNormalizeVolume} className="mt-0.5" />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">
            <SettingHelp hint={t("settings.help.normalizeVolume")}>
              {t("settings.normalizeVolume")}
            </SettingHelp>
          </span>
        </span>
      </label>

      <Equalizer />
    </Panel>
  );
}

function Equalizer() {
  const { locale, t } = useI18n();
  const eq = useEqualizer();
  const presetId = useId();

  if (!eq.supported) return null;

  const frequency = (hz: number) =>
    hz < 1000
      ? t("settings.equalizerHz", { value: hz })
      : t("settings.equalizerKhz", { value: (hz / 1000).toLocaleString(locale) });
  const decibels = (gain: number) =>
    t("settings.equalizerDb", { value: gain > 0 ? `+${gain}` : String(gain) });

  return (
    <div className="flex flex-col gap-4">
      <label className="flex cursor-pointer items-start gap-3">
        <Switch checked={eq.enabled} onCheckedChange={eq.setEnabled} className="mt-0.5" />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">
            <SettingHelp hint={t("settings.help.equalizer")}>{t("settings.equalizer")}</SettingHelp>
          </span>
        </span>
      </label>

      {eq.enabled && (
        <>
          <div className="flex flex-col gap-2">
            <label htmlFor={presetId} className="font-semibold">
              {t("settings.equalizerPreset")}
            </label>
            <Select
              value={eq.preset ?? ""}
              onValueChange={(preset) => eq.applyPreset(preset as EqualizerPreset)}
            >
              <SelectTrigger id={presetId} className="w-full sm:w-64">
                <SelectValue placeholder={t("settings.equalizerCustom")} />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(EQ_PRESETS) as EqualizerPreset[]).map((preset) => (
                  <SelectItem key={preset} value={preset}>
                    {t(`settings.equalizerPreset.${preset}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 overflow-x-auto px-1 py-3">
            <div className="min-w-[600px]">
              <EqualizerCurve
                gains={eq.gains}
                onChange={eq.setGain}
                frequency={frequency}
                decibels={decibels}
                bandLabel={(hz) => t("settings.equalizerBand", { band: frequency(hz) })}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {t("settings.equalizerControls")}
            <span className="mt-1 block sm:hidden">{t("settings.equalizerScrollHint")}</span>
          </p>

          <div className="flex flex-col gap-4 rounded-md border border-border p-4">
            <label className="flex flex-col gap-3">
              <span className="flex items-center justify-between gap-3 font-medium">
                {t("settings.equalizerPreamp")}
                <span className="text-sm text-primary tabular-nums">{decibels(eq.preampDb)}</span>
              </span>
              <input
                type="range"
                min={-EQ_LIMIT_DB}
                max={EQ_LIMIT_DB}
                step={1}
                value={eq.preampDb}
                aria-label={t("settings.equalizerPreamp")}
                aria-valuetext={decibels(eq.preampDb)}
                onChange={(event) => eq.setPreamp(Number(event.target.value))}
                className="h-6 w-full cursor-pointer accent-primary"
              />
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <Switch
                checked={eq.autoHeadroom}
                onCheckedChange={eq.setAutoHeadroom}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-1">
                <span className="font-medium">{t("settings.equalizerAutoHeadroom")}</span>
                <span className="text-sm text-muted-foreground">
                  {t("settings.equalizerHeadroomHint")}
                </span>
              </span>
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                {t("settings.equalizerOutput", { value: decibels(eq.effectivePreampDb) })}
              </span>
              <button
                type="button"
                onClick={eq.reset}
                className="rounded-sm px-3 py-2 text-sm font-medium text-primary hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-ring"
              >
                {t("settings.equalizerReset")}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const EQ_MIN_DB = -EQ_LIMIT_DB;

const EQ_TICKS = [EQ_LIMIT_DB, EQ_LIMIT_DB / 2, 0, EQ_MIN_DB / 2, EQ_MIN_DB];

function EqualizerCurve({
  gains,
  onChange,
  frequency,
  decibels,
  bandLabel,
}: {
  gains: readonly number[];
  onChange: (band: number, gain: number) => void;
  frequency: (hz: number) => string;
  decibels: (gain: number) => string;
  bandLabel: (hz: number) => string;
}) {
  const [focused, setFocused] = useState<number | null>(null);

  const gainAt = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    return Math.round(EQ_LIMIT_DB - ratio * EQ_LIMIT_DB * 2);
  };

  const x = (band: number) => ((band + 0.5) / EQ_BANDS.length) * 100;
  const y = (gain: number) => ((EQ_LIMIT_DB - gain) / (EQ_LIMIT_DB * 2)) * 100;

  const points = [
    [0, y(gains[0])],
    ...gains.map((gain, band) => [x(band), y(gain)]),
    [100, y(gains[gains.length - 1])],
  ];
  const curve = points
    .slice(1)
    .map(([px, py], index) => {
      const before = points[Math.max(0, index - 1)];
      const from = points[index];
      const after = points[Math.min(points.length - 1, index + 2)];
      const c1 = [from[0] + (px - before[0]) / 6, from[1] + (py - before[1]) / 6];
      const c2 = [px - (after[0] - from[0]) / 6, py - (after[1] - from[1]) / 6];
      return `C ${c1.join(" ")} ${c2.join(" ")} ${px} ${py}`;
    })
    .join(" ");
  const line = `M ${points[0].join(" ")} ${curve}`;

  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2 text-2xs text-faint tabular-nums">
      <span />
      <div className="grid" style={{ gridTemplateColumns: `repeat(${EQ_BANDS.length}, 1fr)` }}>
        {gains.map((gain, band) => (
          <span key={band} className="text-center text-muted-foreground">
            {decibels(gain)}
          </span>
        ))}
      </div>

      <div className="relative">
        {EQ_TICKS.map((tick) => (
          <span
            key={tick}
            className="absolute right-0 -translate-y-1/2"
            style={{ top: `${y(tick)}%` }}
          >
            {tick > 0 ? `+${tick}` : tick}
          </span>
        ))}
      </div>

      <div className="relative mt-2 h-52">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-0 size-full overflow-visible"
        >
          <defs>
            <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {EQ_TICKS.map((tick) => (
            <line
              key={tick}
              x1="0"
              x2="100"
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border)"
              strokeDasharray={tick === 0 ? undefined : "2 2"}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {EQ_BANDS.map((hz, band) => (
            <line
              key={hz}
              x1={x(band)}
              x2={x(band)}
              y1="0"
              y2="100"
              stroke="var(--border)"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={`${line} L 100 100 L 0 100 Z`} fill="url(#eq-fill)" />
          <path
            d={line}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {EQ_BANDS.map((hz, band) => (
          <div
            key={hz}
            role="slider"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label={bandLabel(hz)}
            aria-valuemin={EQ_MIN_DB}
            aria-valuemax={EQ_LIMIT_DB}
            aria-valuenow={gains[band]}
            aria-valuetext={decibels(gains[band])}
            onFocus={() => setFocused(band)}
            onBlur={() => setFocused(null)}
            onDoubleClick={() => onChange(band, 0)}
            onPointerDown={(event) => {
              const onHandle = (event.target as HTMLElement).dataset.handle !== undefined;
              if (event.pointerType !== "mouse" && !onHandle) return;

              event.currentTarget.setPointerCapture(event.pointerId);
              onChange(band, gainAt(event));
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                onChange(band, gainAt(event));
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                onChange(band, event.key === "Home" ? EQ_MIN_DB : EQ_LIMIT_DB);
                return;
              }
              const step =
                event.key === "PageUp"
                  ? 3
                  : event.key === "PageDown"
                    ? -3
                    : event.key === "ArrowUp" || event.key === "ArrowRight"
                      ? 1
                      : event.key === "ArrowDown" || event.key === "ArrowLeft"
                        ? -1
                        : 0;
              if (step === 0) return;

              event.preventDefault();
              onChange(band, gains[band] + step);
            }}
            className="absolute inset-y-0 cursor-ns-resize touch-auto outline-none"
            style={{
              left: `${(band / EQ_BANDS.length) * 100}%`,
              width: `${100 / EQ_BANDS.length}%`,
            }}
          >
            <span
              data-handle=""
              className="absolute left-1/2 grid size-11 -translate-1/2 touch-none place-items-center"
              style={{ top: `${y(gains[band])}%` }}
            >
              <span
                className={cn(
                  "pointer-events-none size-4 rounded-full border-2 border-background bg-primary shadow-art",
                  focused === band && "ring-2 ring-ring ring-offset-2 ring-offset-card",
                )}
              />
            </span>
          </div>
        ))}
      </div>

      <span />
      <div
        className="mt-2 grid text-muted-foreground"
        style={{ gridTemplateColumns: `repeat(${EQ_BANDS.length}, 1fr)` }}
      >
        {EQ_BANDS.map((hz) => (
          <span key={hz} className="text-center">
            {frequency(hz)}
          </span>
        ))}
      </div>
    </div>
  );
}

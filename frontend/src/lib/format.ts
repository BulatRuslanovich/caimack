// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import type { ArtistRef } from "@/lib/types";

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";

  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor(totalSeconds / 3600);

  const paddedSeconds = String(seconds).padStart(2, "0");

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
}

export function creditsOf(track: {
  artistId: string;
  artistName: string;
  artists?: ArtistRef[] | null;
}): ArtistRef[] {
  return track.artists?.length ? track.artists : [{ id: track.artistId, name: track.artistName }];
}

export function formatArtists(track: {
  artistName: string;
  artists?: { name: string }[] | null;
}): string {
  const names = track.artists?.map((artist) => artist.name) ?? [];
  return names.length > 0 ? names.join(", ") : track.artistName;
}

export function formatAudioSpec(track: {
  codec?: string | null;
  sampleRateHz?: number | null;
  bitsPerSample?: number | null;
  bitrateKbps?: number | null;
}): string | null {
  if (!track.codec) return null;

  const label = track.codec.toUpperCase();
  const khz = track.sampleRateHz
    ? (track.sampleRateHz / 1000).toFixed(1).replace(/\.0$/, "")
    : null;

  if (track.bitsPerSample && khz) return `${label} ${track.bitsPerSample}/${khz}`;
  if (track.bitrateKbps) return `${label} ${track.bitrateKbps} kbps`;

  return label;
}

export function isLossless(codec: string | null | undefined): boolean {
  return codec === "flac";
}

export function uniformAudioSpec(tracks: Parameters<typeof formatAudioSpec>[0][]): string | null {
  if (tracks.length === 0 || !tracks.every((track) => isLossless(track.codec))) return null;

  const first = formatAudioSpec(tracks[0]);
  if (first === null) return null;

  return tracks.every((track) => formatAudioSpec(track) === first) ? first : null;
}

export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function calendarDaysAgo(date: Date, now: Date = new Date()): number {
  const startOf = (value: Date) => {
    const day = new Date(value);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
  };

  return Math.round((startOf(now) - startOf(date)) / 86_400_000);
}

export function displayTitleClass(title: string): string {
  const length = [...title.trim()].length;

  if (length <= 24) return "font-display text-display";
  if (length <= 48) return "font-display text-title";
  return "font-sans text-title";
}

export function genreName(name: string): string {
  return name ? name.charAt(0).toLocaleUpperCase() + name.slice(1) : name;
}

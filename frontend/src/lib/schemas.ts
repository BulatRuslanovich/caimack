// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { z } from "zod";

export const limits = {
  playlistName: 200,
  playlistDescription: 1000,
  trackTitle: 400,
  artistName: 300,
  albumTitle: 300,
  genreName: 150,
  username: 20,
  password: { min: 8, max: 72 },
  lyrics: 200_000,
} as const;

const trimmed = (max: number) => z.string().trim().max(max);
const required = (max: number) => trimmed(max).min(1);
const newPassword = z
  .string()
  .refine(
    (value) =>
      Array.from(value).length >= limits.password.min &&
      new TextEncoder().encode(value).byteLength <= limits.password.max,
  );

const optionalNumber = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : Number.parseInt(value, 10)))
  .refine((value) => value === null || Number.isFinite(value), { message: "—" });

export const yearRange = { min: 1500, max: 2999 } as const;

export const playlistSchema = z.object({
  name: required(limits.playlistName),
  description: trimmed(limits.playlistDescription),
  isPublic: z.boolean(),
});

export const lyricsSchema = z.object({
  text: z.string().max(limits.lyrics),
});

export type LyricsValues = z.infer<typeof lyricsSchema>;

export const trackSchema = z.object({
  title: required(limits.trackTitle),
  artist: trimmed(limits.artistName),
  album: trimmed(limits.albumTitle),
  genre: trimmed(limits.genreName),
  year: optionalNumber,
  trackNumber: optionalNumber,
  discNumber: optionalNumber,
});

export const artistSchema = z.object({
  name: required(limits.artistName),
});

export const albumSchema = z.object({
  title: required(limits.albumTitle),
  artist: required(limits.artistName),
  year: optionalNumber.refine(
    (value) => value === null || (value >= yearRange.min && value <= yearRange.max),
    { message: "—" },
  ),
});

export const newUserSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._-]{4,19}$/),
  password: newPassword,
  isAdmin: z.boolean(),
});

export const inviteSchema = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9._-]{4,19}$/),
    password: newPassword,
    repeat: z.string(),
  })
  .refine((values) => values.password === values.repeat, {
    path: ["repeat"],
    message: "mismatch",
  });

export type InviteValues = z.infer<typeof inviteSchema>;

export const signInSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export const passwordResetSchema = z
  .object({
    next: newPassword,
    repeat: z.string(),
  })
  .refine((values) => values.next === values.repeat, {
    path: ["repeat"],
    message: "mismatch",
  });

export const passwordChangeSchema = z
  .object({
    current: z.string().min(1),
    next: newPassword,
    repeat: z.string(),
  })
  .refine((values) => values.next === values.repeat, {
    path: ["repeat"],
    message: "mismatch",
  });

export type PlaylistValues = z.infer<typeof playlistSchema>;

export type TrackInput = z.input<typeof trackSchema>;
export type TrackValues = z.output<typeof trackSchema>;
export type ArtistValues = z.infer<typeof artistSchema>;
export type AlbumInput = z.input<typeof albumSchema>;
export type AlbumValues = z.output<typeof albumSchema>;
export type NewUserValues = z.infer<typeof newUserSchema>;
export type SignInValues = z.infer<typeof signInSchema>;
export type PasswordChangeValues = z.infer<typeof passwordChangeSchema>;
export type PasswordResetValues = z.infer<typeof passwordResetSchema>;

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

const RENEW_AT = 2 / 3;
const MINIMUM_MS = 30_000;
const MAXIMUM_MS = 60 * 60_000;

export function renewalIntervalMs(accessTokenMinutes: number): number {
  if (!Number.isFinite(accessTokenMinutes) || accessTokenMinutes <= 0) return MINIMUM_MS;

  const lifetime = accessTokenMinutes * 60_000;

  return Math.min(Math.max(lifetime * RENEW_AT, MINIMUM_MS), MAXIMUM_MS);
}

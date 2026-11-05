// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { expect, it } from "vitest";
import { inviteSchema, newUserSchema, passwordChangeSchema, passwordResetSchema } from "./schemas";

it.each(["", "short", "я".repeat(4), "é".repeat(37), "🔑".repeat(19)])(
  "rejects passwords outside the server policy in every password form: %s",
  (password) => {
    expect(newUserSchema.safeParse({ username: "alice", password, isAdmin: false }).success).toBe(
      false,
    );
    expect(inviteSchema.safeParse({ username: "alice", password, repeat: password }).success).toBe(
      false,
    );
    expect(passwordResetSchema.safeParse({ next: password, repeat: password }).success).toBe(false);
    expect(
      passwordChangeSchema.safeParse({ current: "password", next: password, repeat: password })
        .success,
    ).toBe(false);
  },
);

it.each(["password", "a".repeat(72), "я".repeat(36), "🔑".repeat(18)])(
  "accepts valid passwords at the UTF-8 length boundaries: %s",
  (password) => {
    expect(passwordResetSchema.safeParse({ next: password, repeat: password }).success).toBe(true);
  },
);

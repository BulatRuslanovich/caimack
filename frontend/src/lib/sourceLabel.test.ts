// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import type { Translate } from "@/contexts/I18nContext";
import { sourceLabel } from "./sourceLabel";

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}(${Object.values(values).join(",")})` : key) as Translate;

describe("sourceLabel", () => {
  it("names known sources", () => {
    expect(sourceLabel("home:forYou", t)).toBe("source.home:forYou");
    expect(sourceLabel("radio:autoplay", t)).toBe("source.radio:autoplay");
  });

  it("names a mood radio after its mood", () => {
    expect(sourceLabel("radio:mood:sad", t)).toBe("source.radioMood(radio.mood.sad)");
  });

  it("shows an unrecorded source as unknown and a strange one as is", () => {
    expect(sourceLabel(null, t)).toBe("source.unknown");
    expect(sourceLabel("mix:weird", t)).toBe("mix:weird");
  });
});

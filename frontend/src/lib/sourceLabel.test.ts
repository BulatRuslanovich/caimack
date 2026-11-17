// SPDX-License-Identifier: AGPL-3.0-only

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

  it("groups historical radio variants", () => {
    expect(sourceLabel("radio:previous", t)).toBe("source.radio");
  });

  it.each(["albums", "artists", "playlists"])(
    "translates the %s catalog separately from detail pages",
    (source) => {
      expect(sourceLabel(source, t)).toBe(`source.${source}`);
      expect(sourceLabel(source.slice(0, -1), t)).toBe(`source.${source.slice(0, -1)}`);
    },
  );

  it("shows an unrecorded source as unknown and a strange one as is", () => {
    expect(sourceLabel(null, t)).toBe("source.unknown");
    expect(sourceLabel("mix:weird", t)).toBe("mix:weird");
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import type { Translate } from "@/contexts/I18nContext";
import type { HomeBlock } from "@/lib/types";
import { blockNote, blockSubjectHref, blockTitle } from "./blockMeta";

function block(baseKey: string, zone: HomeBlock["zone"] = "Browse"): HomeBlock {
  return { key: baseKey, baseKey, layout: "Shelf", zone, tracks: [] };
}

const t: Translate = (key, values) =>
  values?.subject ? `${key}:${String(values.subject)}` : String(key);

function explained(baseKey: string, kind: string, subject?: string): HomeBlock {
  return { ...block(baseKey), reason: { kind, subject: subject ?? null, subjectId: null } };
}

describe("blockTitle", () => {
  it("names a personal shelf by the reason it is there", () => {
    expect(blockTitle(explained("forYou", "soundsLike", "November"), t)).toBe(
      "rec.reason.soundsLike:November",
    );
  });

  it("falls back to a plain title when the shelf carries no reason", () => {
    expect(blockTitle(block("forYou"), t)).toBe("rec.shelf.forYou");
  });
});

describe("blockSubjectHref", () => {
  it("links an artist or genre the reason is about", () => {
    const artist = {
      ...block("becauseYouListened"),
      reason: { kind: "becauseYouListened", subject: "Aphex", subjectId: "a1" },
    };
    const genre = {
      ...block("forYou"),
      reason: { kind: "fromGenreYouLike", subject: "Jazz", subjectId: "g1" },
    };

    expect(blockSubjectHref(artist)).toBe("/artists/a1");
    expect(blockSubjectHref(genre)).toBe("/genres?id=g1");
  });

  it("does not link a track, which has no page of its own", () => {
    const track = {
      ...block("forYou"),
      reason: { kind: "soundsLike", subject: "November", subjectId: "t1" },
    };

    expect(blockSubjectHref(track)).toBeUndefined();
  });
});

describe("blockNote", () => {
  it("explains a shelf whose title says nothing about why it is there", () => {
    expect(blockNote(explained("artistsForYou", "becauseYouListened", "Boards of Canada"), t)).toBe(
      "rec.reason.becauseYouListened:Boards of Canada",
    );
  });

  it("stays silent when the title already is the reason", () => {
    expect(blockNote(explained("forYou", "soundsLike", "November"), t)).toBeUndefined();
  });

  it("stays silent when the title already is the reason", () => {
    expect(
      blockNote(explained("becauseYouListened", "becauseYouListened", "Aphex"), t),
    ).toBeUndefined();
  });

  it("stays silent when the reason restates the title", () => {
    expect(blockNote(explained("discover", "discovery"), t)).toBeUndefined();
  });

  it("names the period of the chart, which nothing else on the page does", () => {
    expect(blockNote(block("topTracks"), t)).toBe("home.topPeriod");
  });

  it("has nothing to say about a block that carries no reason", () => {
    expect(blockNote(block("forYou"), t)).toBeUndefined();
    expect(blockNote(block("newAlbums"), t)).toBeUndefined();
  });
});

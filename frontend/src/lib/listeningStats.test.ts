// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "vitest";
import { listeningDate, listeningRange } from "./listeningStats";

describe("listening calendar", () => {
  it("preserves the server calendar date regardless of the viewer's zone", () => {
    const day = listeningDate("2026-11-09");
    expect(day.getUTCDate()).toBe(9);
    expect(day.getUTCDay()).toBe(1);
    expect(listeningRange({ startDate: "2026-11-09", endDate: "2026-11-15" }, "en")).toContain("9");
  });
  it("includes both years for a week crossing New Year", () => {
    const range = listeningRange({ startDate: "2025-12-29", endDate: "2026-01-04" }, "ru");
    expect(range).toContain("2025");
    expect(range).toContain("2026");
  });
});

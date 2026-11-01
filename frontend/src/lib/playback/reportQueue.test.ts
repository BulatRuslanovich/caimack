// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich
import { expect, it } from "vitest";
import { reportQueue } from "./reportQueue";

it("bounds a long handoff queue and preserves the current song", () => {
  const queue = Array.from({ length: 20_000 }, (_, index) => ({ id: String(index) }));
  const report = reportQueue(queue, 10_000);
  expect(report.trackIds).toHaveLength(501);
  expect(report.trackIds[report.index]).toBe("10000");
});
it("keeps short queues and edge positions intact", () => {
  const queue = [{ id: "a" }, { id: "b" }];
  expect(reportQueue(queue, 0)).toEqual({ trackIds: ["a", "b"], index: 0 });
  expect(reportQueue(queue, 1)).toEqual({ trackIds: ["a", "b"], index: 1 });
});

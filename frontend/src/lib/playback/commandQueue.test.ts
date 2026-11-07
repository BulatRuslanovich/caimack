// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { expect, it, vi } from "vitest";
import { CommandQueue } from "./commandQueue";

it("coalesces slider updates while preserving the order of transport commands", async () => {
  const queue = new CommandQueue<number>();
  const gate = Promise.withResolvers<void>();
  const calls: number[] = [];
  const run = async (value: number) => {
    calls.push(value);
    if (value === 1) await gate.promise;
  };
  const pending = [
    queue.enqueue(1, run),
    queue.enqueue(2, run, "volume"),
    queue.enqueue(3, run, "volume"),
    queue.enqueue(4, run),
  ];
  gate.resolve();
  await Promise.all(pending);
  expect(calls).toEqual([1, 3, 4]);
});

it("discards queued commands after a timeout instead of replaying them after reconnect", async () => {
  const queue = new CommandQueue<number>();
  const gate = Promise.withResolvers<void>();
  const later = vi.fn().mockResolvedValue(undefined);
  const first = queue.enqueue(1, () => gate.promise);
  const second = queue.enqueue(2, later);
  const settled = Promise.allSettled([first, second]);
  gate.reject(new Error("device disconnected"));
  expect((await settled).map((result) => result.status)).toEqual(["rejected", "rejected"]);
  expect(later).not.toHaveBeenCalled();
});

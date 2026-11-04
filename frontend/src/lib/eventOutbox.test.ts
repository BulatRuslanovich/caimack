// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it, vi } from "vitest";
import {
  createEventOutbox,
  type EventOutboxEntry,
  type EventOutboxStorage,
} from "@/lib/eventOutbox";

class MemoryOutboxStorage<T> implements EventOutboxStorage<T> {
  entries: EventOutboxEntry<T>[] = [];

  async add(entry: EventOutboxEntry<T>): Promise<void> {
    this.entries.push(entry);
  }

  async list(limit = this.entries.length): Promise<EventOutboxEntry<T>[]> {
    return this.entries.slice(0, limit);
  }

  async remove(ids: string[]): Promise<void> {
    const removed = new Set(ids);
    this.entries = this.entries.filter((entry) => !removed.has(entry.id));
  }

  async count(): Promise<number> {
    return this.entries.length;
  }
}

describe("event outbox", () => {
  it("keeps events offline and delivers them when the connection returns", async () => {
    const storage = new MemoryOutboxStorage<{ type: string }>();
    const send = vi.fn(async () => true);
    let online = false;
    const outbox = createEventOutbox({ storage, send, isOnline: () => online });

    await outbox.add({ type: "trackPlayed" });
    expect(await outbox.flush()).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(storage.entries).toHaveLength(1);

    online = true;
    expect(await outbox.flush()).toBe(true);
    expect(send).toHaveBeenCalledWith([{ type: "trackPlayed" }]);
    expect(storage.entries).toHaveLength(0);
  });

  it("retains a batch when delivery fails", async () => {
    const storage = new MemoryOutboxStorage<{ type: string }>();
    const outbox = createEventOutbox({
      storage,
      send: async () => false,
      isOnline: () => true,
    });

    await outbox.add({ type: "trackCompleted" });
    expect(await outbox.flush()).toBe(false);
    expect(storage.entries).toHaveLength(1);
  });

  it("drops the oldest events once the outbox is full", async () => {
    const storage = new MemoryOutboxStorage<number>();
    const outbox = createEventOutbox({
      storage,
      send: async () => true,
      isOnline: () => false,
      capacity: 3,
    });

    for (const value of [1, 2, 3, 4, 5]) await outbox.add(value);

    expect(storage.entries.map((entry) => entry.payload)).toEqual([3, 4, 5]);
  });

  it("keys events so that they sort by the moment they happened", async () => {
    vi.useFakeTimers();

    try {
      const storage = new MemoryOutboxStorage<number>();
      const outbox = createEventOutbox({ storage, send: async () => true, isOnline: () => false });

      vi.setSystemTime(new Date("2026-09-05T00:00:00Z"));
      await outbox.add(1);
      vi.setSystemTime(new Date("2060-09-05T00:00:00Z"));
      await outbox.add(2);

      const ids = storage.entries.map((entry) => entry.id);
      expect([...ids].sort()).toEqual(ids);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drains more than one batch after a long offline session", async () => {
    const storage = new MemoryOutboxStorage<number>();
    const send = vi.fn(async () => true);
    const outbox = createEventOutbox({
      storage,
      send,
      isOnline: () => true,
      batchSize: 2,
    });

    await Promise.all([outbox.add(1), outbox.add(2), outbox.add(3)]);
    await outbox.flush();

    expect(send.mock.calls).toEqual([[[1, 2]], [[3]]]);
    expect(storage.entries).toHaveLength(0);
  });
});

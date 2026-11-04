// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

export interface EventOutboxEntry<T> {
  id: string;
  payload: T;
}

export interface EventOutboxStorage<T> {
  add(entry: EventOutboxEntry<T>): Promise<void>;
  list(limit: number): Promise<EventOutboxEntry<T>[]>;
  remove(ids: string[]): Promise<void>;
  count(): Promise<number>;
}

interface EventOutboxOptions<T> {
  storage: EventOutboxStorage<T>;
  send: (events: T[]) => Promise<boolean>;
  isOnline: () => boolean;
  batchSize?: number;
  capacity?: number;
}

function monotonicId(): string {
  return `${Date.now().toString(36).padStart(9, "0")}-${crypto.randomUUID()}`;
}

export interface EventOutbox<T> {
  add(event: T): Promise<void>;
  flush(): Promise<boolean>;
}

export function createEventOutbox<T>({
  storage,
  send,
  isOnline,
  batchSize = 100,
  capacity = 5_000,
}: EventOutboxOptions<T>): EventOutbox<T> {
  let writes = Promise.resolve();
  let flushing: Promise<boolean> | null = null;

  return {
    add(event) {
      const write = writes.then(async () => {
        await storage.add({ id: monotonicId(), payload: event });

        const overflow = (await storage.count()) - capacity;
        if (overflow > 0) {
          await storage.remove((await storage.list(overflow)).map((entry) => entry.id));
        }
      });

      writes = write.catch(() => {});
      return write;
    },

    flush() {
      if (flushing) return flushing;

      flushing = (async () => {
        await writes;
        if (!isOnline()) return false;

        for (;;) {
          const entries = await storage.list(batchSize);
          if (entries.length === 0) return true;
          if (!(await send(entries.map((entry) => entry.payload)))) return false;

          await storage.remove(entries.map((entry) => entry.id));
          if (entries.length < batchSize) return true;
          if (!isOnline()) return false;
        }
      })().finally(() => {
        flushing = null;
      });

      return flushing;
    },
  };
}

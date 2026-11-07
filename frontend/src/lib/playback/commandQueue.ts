// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

interface Job<T> {
  value: T;
  key?: string;
  run: (value: T) => Promise<void>;
  waiters: { resolve: () => void; reject: (error: unknown) => void }[];
}

/** Serialize controls and keep only the latest adjacent slider/seek update. */
export class CommandQueue<T> {
  private jobs: Job<T>[] = [];
  private running = false;

  enqueue(value: T, run: (value: T) => Promise<void>, key?: string): Promise<void> {
    if (this.jobs.length >= 32)
      return Promise.reject(new Error("Too many pending playback commands."));
    const result = new Promise<void>((resolve, reject) => {
      const last = this.jobs.at(-1);
      if (key && last?.key === key) {
        last.value = value;
        last.waiters.push({ resolve, reject });
      } else this.jobs.push({ value, key, run, waiters: [{ resolve, reject }] });
    });
    void this.drain();
    return result;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let job: Job<T> | undefined;
      while ((job = this.jobs.shift())) {
        try {
          await job.run(job.value);
          for (const waiter of job.waiters) waiter.resolve();
        } catch (error) {
          // After a failed command the resulting queue is uncertain. Do not replay
          // queued edits later when an unavailable renderer comes back online.
          for (const pending of [job, ...this.jobs.splice(0)])
            for (const waiter of pending.waiters) waiter.reject(error);
          break;
        }
      }
    } finally {
      this.running = false;
    }
  }
}

// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");

export class Storage {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.directory = directory;
    this.db = new DatabaseSync(join(directory, "state.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.read = this.db.prepare("SELECT value FROM state WHERE key=?");
    this.write = this.db.prepare("INSERT OR REPLACE INTO state VALUES (?, ?)");
    this.remove = this.db.prepare("DELETE FROM state WHERE key=?");
  }

  get(key, fallback = null) {
    const row = this.read.get(key);
    return row ? JSON.parse(row.value) : fallback;
  }

  set(key, value) {
    this.write.run(key, JSON.stringify(value));
  }

  delete(key) {
    this.remove.run(key);
  }

  entries(prefix) {
    return this.db
      .prepare(
        "SELECT key,value FROM state WHERE key >= ? AND key < ? ORDER BY rowid",
      )
      .all(prefix, prefix + "\uffff")
      .map((row) => [row.key, JSON.parse(row.value)]);
  }

  deletePrefix(prefix) {
    this.db
      .prepare("DELETE FROM state WHERE key >= ? AND key < ?")
      .run(prefix, prefix + "\uffff");
  }

  transaction(work) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (reason) {
      this.db.exec("ROLLBACK");
      throw reason;
    }
  }
}

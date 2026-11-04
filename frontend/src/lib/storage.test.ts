// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { afterEach, describe, expect, it, vi } from "vitest";
import { readStored, readStoredJson, writeStored, writeStoredJson } from "@/lib/storage";

function memoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new DOMException("denied", "SecurityError");
  };

  return {
    length: 0,
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storage", () => {
  it("round-trips strings and JSON in the chosen area", () => {
    const local = memoryStorage();
    const session = memoryStorage();
    vi.stubGlobal("window", { localStorage: local, sessionStorage: session });

    writeStored("theme", "light");
    writeStoredJson("queue", { index: 2 }, "session");

    expect(readStored("theme")).toBe("light");
    expect(readStored("theme", "session")).toBeNull();
    expect(readStoredJson("queue", "session")).toEqual({ index: 2 });
  });

  it("removes a key when written with null", () => {
    vi.stubGlobal("window", { localStorage: memoryStorage(), sessionStorage: memoryStorage() });

    writeStored("theme", "light");
    writeStored("theme", null);

    expect(readStored("theme")).toBeNull();
  });

  it("drops a corrupt JSON entry instead of failing on it at every start", () => {
    const local = memoryStorage();
    vi.stubGlobal("window", { localStorage: local, sessionStorage: memoryStorage() });
    local.setItem("player", "{not json");

    expect(readStoredJson("player")).toBeNull();
    expect(local.getItem("player")).toBeNull();
  });

  it("reads null and writes nothing when the storage throws on every call", () => {
    vi.stubGlobal("window", { localStorage: throwingStorage(), sessionStorage: throwingStorage() });

    expect(readStored("theme")).toBeNull();
    expect(readStoredJson("player")).toBeNull();
    expect(() => writeStored("theme", "light")).not.toThrow();
    expect(() => writeStored("theme", null, "session")).not.toThrow();
  });

  it("survives a browser that refuses access to the storage object itself", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new DOMException("denied", "SecurityError");
      },
    });

    expect(readStored("theme")).toBeNull();
    expect(() => writeStoredJson("player", { index: 0 })).not.toThrow();
  });
});

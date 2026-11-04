// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track, UploadResult } from "@/lib/types";
import { uploadFiles } from "./upload";

type Reply = "drop" | { status: number; body: unknown };

class FakeXhr {
  static replies: Reply[] = [];
  static sent = 0;

  status = 0;
  responseText = "";
  withCredentials = false;
  upload = { addEventListener: () => {} };
  private listeners: Record<string, () => void> = {};

  open() {}
  setRequestHeader() {}

  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = listener;
  }

  send() {
    FakeXhr.sent += 1;
    const reply = FakeXhr.replies.shift() ?? "drop";

    queueMicrotask(() => {
      if (reply === "drop") {
        this.listeners.error?.();
        return;
      }

      this.status = reply.status;
      this.responseText = JSON.stringify(reply.body);
      this.listeners.load?.();
    });
  }
}

const track = { id: "t1", title: "Song" } as Track;
const stored: UploadResult = { uploaded: [track], failed: [] };

async function upload(findUploaded?: (file: File) => Promise<Track | null>) {
  const pending = uploadFiles(
    [new File(["x"], "song.mp3")],
    () => {},
    () => {},
    findUploaded,
  );
  await vi.runAllTimersAsync();
  return pending;
}

describe("uploadFiles", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    FakeXhr.replies = [];
    FakeXhr.sent = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the file again after the connection drops", async () => {
    FakeXhr.replies = ["drop", { status: 200, body: stored }];

    const result = await upload();

    expect(result.uploaded).toEqual([track]);
    expect(FakeXhr.sent).toBe(2);
  });

  it("does not resend a file the server stored before the connection dropped", async () => {
    FakeXhr.replies = ["drop"];

    const result = await upload(() => Promise.resolve(track));

    expect(result).toEqual(stored);
    expect(FakeXhr.sent).toBe(1);
  });

  it("retries a gateway that is briefly unavailable", async () => {
    FakeXhr.replies = [
      { status: 502, body: null },
      { status: 200, body: stored },
    ];

    const result = await upload();

    expect(result.uploaded).toEqual([track]);
  });

  it("does not retry a file the server refused", async () => {
    FakeXhr.replies = [{ status: 500, body: { detail: "broken" } }];

    const result = await upload();

    expect(result.failed).toEqual([{ fileName: "song.mp3", reason: "broken" }]);
    expect(FakeXhr.sent).toBe(1);
  });

  it("gives up after a few attempts and reports the file as failed", async () => {
    const result = await upload();

    expect(result.uploaded).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(FakeXhr.sent).toBe(4);
  });
});

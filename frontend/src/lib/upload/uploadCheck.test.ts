// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadProbeFile, UploadProbeResult } from "@/lib/types";

const checkUpload = vi.fn<(files: UploadProbeFile[]) => Promise<UploadProbeResult>>();

vi.mock("../api", () => ({
  api: { checkUpload: (files: UploadProbeFile[]) => checkUpload(files) },
}));
vi.mock("./audioTags", () => ({ readAudioTags: () => Promise.resolve({}) }));
vi.mock("./fileHash", () => ({ sha256File: () => Promise.resolve("a".repeat(64)) }));

const { checkAgainstLibrary, fileKey, isDuplicate } = await import("./uploadCheck");

function audio(name: string): File {
  return new File(["something"], name);
}

describe("checkAgainstLibrary", () => {
  beforeEach(() => {
    checkUpload.mockReset();
  });

  it("reports files as unchecked rather than new when the check fails", async () => {
    checkUpload.mockRejectedValue(new Error("offline"));

    const file = audio("song.mp3");
    const checks = await checkAgainstLibrary([file]);

    expect(checks[fileKey(file)]).toEqual({ state: "failed" });
  });

  it("does not pass off a short answer as a verdict on every file", async () => {
    checkUpload.mockResolvedValue({
      files: [{ fileName: "one.mp3", verdict: "New", basis: "Hash" }],
    });

    const files = [audio("one.mp3"), audio("two.mp3")];
    const checks = await checkAgainstLibrary(files);

    expect(checks[fileKey(files[0])].state).toBe("checked");
    expect(checks[fileKey(files[1])]).toEqual({ state: "failed" });
  });

  it("carries the match and the basis the server reported", async () => {
    checkUpload.mockResolvedValue({
      files: [
        { fileName: "dupe.mp3", verdict: "Duplicate", basis: "Hash" },
        { fileName: "bare.mp3", verdict: "New", basis: "None" },
      ],
    });

    const files = [audio("dupe.mp3"), audio("bare.mp3")];
    const checks = await checkAgainstLibrary(files);

    expect(isDuplicate(checks[fileKey(files[0])])).toBe(true);
    expect(checks[fileKey(files[1])]).toEqual({
      state: "checked",
      verdict: "New",
      basis: "None",
      match: null,
    });
  });
});

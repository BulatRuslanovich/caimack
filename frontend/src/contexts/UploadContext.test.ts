// SPDX-License-Identifier: AGPL-3.0-only

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { UploadProvider, useUpload } from "./UploadContext";

const check = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@/lib/upload/uploadCheck", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/upload/uploadCheck")>()),
  checkAgainstLibrary: check,
}));
vi.mock("@/lib/useSettings", () => ({ useSettings: () => ({ maxUploadBytes: Infinity }) }));
vi.mock("@/lib/useToast", () => ({ useToast: () => ({ notify: vi.fn(), notifyError: vi.fn() }) }));
vi.mock("@/lib/useInvalidate", () => ({ useInvalidate: () => vi.fn() }));
vi.mock("@/lib/useFormat", () => ({ useFormat: () => ({ bytes: String }) }));
vi.mock("./I18nContext", () => ({ useT: () => (key: string) => key }));

it("checks only one copy of each file in an incoming batch", () => {
  let upload!: ReturnType<typeof useUpload>;
  function Probe() {
    upload = useUpload();
    return null;
  }
  renderToStaticMarkup(createElement(UploadProvider, null, createElement(Probe)));
  const first = new File(["audio"], "song.mp3", { lastModified: 1 });
  const duplicate = new File(["audio"], "song.mp3", { lastModified: 1 });
  const other = new File(["audio"], "other.mp3", { lastModified: 1 });

  upload.add([first, duplicate, other]);

  expect(check).toHaveBeenCalledOnce();
  expect(check).toHaveBeenCalledWith([first, other]);
});

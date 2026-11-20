// SPDX-License-Identifier: AGPL-3.0-only

import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AudiobooksPage } from "./AudiobookViews";

const platform = vi.hoisted(() => ({ isDesktop: false }));
vi.mock("@/desktop/runtime", () => platform);
vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));
vi.mock("@/contexts/AudiobookContext", () => ({
  useAudiobooks: () => ({
    enabled: true,
    books: [],
    result: {},
    downloaded: new Set(),
    online: true,
  }),
}));

it.each([false, true])(
  "shows the downloaded filter only in the desktop client (desktop=%s)",
  (desktop) => {
    platform.isDesktop = desktop;
    const html = renderToStaticMarkup(<AudiobooksPage />);
    expect(html.includes(">audiobooks.downloaded<")).toBe(desktop);
    expect(html).toContain(">audiobooks.saved<");
  },
);

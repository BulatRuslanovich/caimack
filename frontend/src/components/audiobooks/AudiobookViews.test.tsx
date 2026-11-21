// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AudiobooksPage } from "./AudiobookViews";

const session = vi.hoisted(() => ({ isDesktop: false, isAdmin: false, enabled: true }));
vi.mock("@/desktop/runtime", () => session);
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => session }));
vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));
vi.mock("@/contexts/AudiobookContext", () => ({
  useAudiobooks: () => ({
    enabled: session.enabled,
    books: [],
    result: {},
    downloaded: new Set(),
    online: true,
  }),
}));

it.each([false, true])(
  "shows the downloaded filter only in the desktop client (desktop=%s)",
  (desktop) => {
    Object.assign(session, { isDesktop: desktop, isAdmin: false, enabled: true });
    const html = renderToStaticMarkup(<AudiobooksPage />);
    expect(html.includes(">audiobooks.downloaded<")).toBe(desktop);
    expect(html).toContain(">audiobooks.saved<");
  },
);

it.each([
  { isDesktop: false, isAdmin: true, enabled: true, showsUpload: true },
  { isDesktop: false, isAdmin: false, enabled: true, showsUpload: false },
  { isDesktop: false, isAdmin: true, enabled: false, showsUpload: false },
  { isDesktop: true, isAdmin: true, enabled: true, showsUpload: false },
])("gates web uploads (desktop=$isDesktop, admin=$isAdmin, enabled=$enabled)", (test) => {
  Object.assign(session, test);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <AudiobooksPage />
    </QueryClientProvider>,
  );
  expect(html.includes(">audiobooks.upload<")).toBe(test.showsUpload);
});

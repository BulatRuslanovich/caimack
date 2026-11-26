// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Audiobook } from "@/lib/audiobooks";
import { AudiobooksPage } from "./AudiobookViews";

const session = vi.hoisted(() => ({
  isDesktop: false,
  isAdmin: false,
  enabled: true,
  books: [] as Audiobook[],
}));
vi.mock("@/desktop/runtime", () => session);
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => session }));
vi.mock("@/contexts/I18nContext", () => {
  const t = (key: string) => key;
  return { useT: () => t, useI18n: () => ({ locale: "en", t }) };
});
vi.mock("@/contexts/AudiobookContext", () => ({
  useAudiobooks: () => ({
    enabled: session.enabled,
    books: session.books,
    result: {},
    downloaded: new Set(),
    online: true,
    player: {},
  }),
}));

it.each([false, true])(
  "shows the downloaded filter only in the desktop client (desktop=%s)",
  (desktop) => {
    Object.assign(session, { isDesktop: desktop, isAdmin: false, enabled: true });
    const html = renderToStaticMarkup(<AudiobooksPage />);
    expect(html.includes(">audiobooks.downloaded<")).toBe(desktop);
    expect(html).toContain(">audiobooks.saved<");
    expect(html).not.toContain(">audiobooks.recent<");
    expect(html).not.toContain(">audiobooks.duration<");
  },
);

it("lists books by most recent listening progress", () => {
  const book = { author: null, narrator: null, coverUrl: null, chapters: [], saved: false };
  const completed = { chapterId: "chapter", positionMs: 0, completed: true };
  Object.assign(session, {
    isDesktop: false,
    isAdmin: false,
    enabled: true,
    books: [
      { ...book, id: "new", title: "Unstarted book", durationMs: 500, progress: null },
      {
        ...book,
        id: "old",
        title: "Older book",
        durationMs: 1000,
        progress: { ...completed, updatedAtMs: 1 },
      },
      {
        ...book,
        id: "recent",
        title: "Recent book",
        durationMs: 2000,
        progress: { ...completed, updatedAtMs: 2 },
      },
    ],
  });
  try {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <AudiobooksPage />
      </QueryClientProvider>,
    );
    expect(html.match(/>(Recent|Older|Unstarted) book<\/a>/g)).toEqual([
      ">Recent book</a>",
      ">Older book</a>",
      ">Unstarted book</a>",
    ]);
  } finally {
    session.books = [];
  }
});

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

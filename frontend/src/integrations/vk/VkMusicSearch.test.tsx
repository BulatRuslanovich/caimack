// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { VkMusicSearch } from "./VkMusicSearch";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/contexts/I18nContext", () => ({ useT: () => (key: string) => key }));

it("shows VK search and playlist import with the current query", () => {
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <VkMusicSearch query="Kingdom of Predators" onChange={() => {}} />
    </QueryClientProvider>,
  );
  expect(markup).toContain("vkMusic.placeholder");
  expect(markup).toContain("vkMusic.playlist.import");
  expect(markup).toContain('value="Kingdom of Predators"');
});

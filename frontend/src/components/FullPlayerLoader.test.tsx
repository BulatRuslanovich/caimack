// SPDX-License-Identifier: AGPL-3.0-only
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { DeferredFullPlayer, loadFullPlayer } from "./FullPlayerLoader";

vi.mock("./FullScreenPlayer", () => ({ FullScreenPlayer: () => <span>Ready player</span> }));

it("renders the loaded player synchronously, without suspending inside the view transition", async () => {
  const props = { onClose: () => {}, onToggleFavorite: () => {} };
  expect(renderToStaticMarkup(<DeferredFullPlayer {...props} />)).toBe("");
  const first = loadFullPlayer();
  expect(loadFullPlayer()).toBe(first);
  await first;
  expect(renderToStaticMarkup(<DeferredFullPlayer {...props} />)).toBe("<span>Ready player</span>");
});

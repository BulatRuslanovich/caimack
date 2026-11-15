// SPDX-License-Identifier: AGPL-3.0-only
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerBackdrop } from "@/components/ArtBackdrop";
import { PlayerEffectsBackdrop } from "@/components/PlayerEffectsBackdrop";
import { usePlayerEffects, playerEffectsState } from "@/lib/playerEffects";

vi.mock("@/lib/playerEffects", async (original) => ({
  ...(await original<typeof import("@/lib/playerEffects")>()),
  usePlayerEffects: vi.fn(),
}));
vi.mock("@/components/ArtworkScene", () => ({
  useArtworkScene: () => ({
    current: { key: "current", src: "/cover.jpg", tone: null, item: { id: "current" } },
    previous: { key: "previous", src: "/old.jpg", tone: null, item: { id: "previous" } },
    trackId: "current",
    direction: "next",
    onAnimationEnd: () => {},
  }),
}));
vi.mock("next/dynamic", () => ({
  default:
    () =>
    ({ effect }: { effect: string }) => <canvas data-player-effect={effect} />,
}));

beforeEach(() => {
  vi.mocked(usePlayerEffects).mockReturnValue(playerEffectsState(null));
});

describe("optional player backgrounds", () => {
  it("defaults to no effect and keeps the base backdrop free of lava canvases", () => {
    expect(playerEffectsState(null).effect).toBe("off");
    expect(renderToStaticMarkup(<PlayerBackdrop />)).not.toContain("<canvas");
    expect(renderToStaticMarkup(<PlayerEffectsBackdrop playing />)).toBe("");
  });

  it("renders lava only when selected, with intensity and both artwork transition layers", () => {
    vi.mocked(usePlayerEffects).mockReturnValue(
      playerEffectsState({ effect: "lava", intensity: 35 }),
    );
    const markup = renderToStaticMarkup(<PlayerEffectsBackdrop playing />);
    expect(markup.match(/class="lava-backdrop"/g)).toHaveLength(2);
    expect(markup).toContain("opacity:0.35");
    expect(markup).toContain('data-state="leaving"');
    expect(markup).toContain('data-state="entering"');
    expect(markup).not.toContain("data-player-effect");
  });

  it("removes lava at zero intensity or when effects are switched off", () => {
    for (const preferences of [{ effect: "lava", intensity: 0 }, { effect: "off" }]) {
      vi.mocked(usePlayerEffects).mockReturnValue(playerEffectsState(preferences));
      expect(renderToStaticMarkup(<PlayerEffectsBackdrop playing />)).toBe("");
    }
  });

  it("keeps music effects on their own renderer without lava underneath", () => {
    for (const effect of ["aurora", "glass"]) {
      vi.mocked(usePlayerEffects).mockReturnValue(playerEffectsState({ effect }));
      const markup = renderToStaticMarkup(<PlayerEffectsBackdrop playing />);
      expect(markup).toContain(`data-player-effect="${effect}"`);
      expect(markup).not.toContain("lava-backdrop");
    }
  });
});

// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { translateWith, type TranslationKey, type TranslationValues } from "@/lib/i18n";
import { ru } from "@/lib/i18n/ru";
import { backdropRgb, playerBackdropSurface } from "@/lib/visuals/playerBackdrop";
import { PlayerTransport } from "./PlayerTransport";
import { SearchTabs } from "@/app/search/SearchTabs";
import { Button } from "./ui/button";

const state = vi.hoisted(() => ({
  isPlaying: false,
  buffering: false,
  shuffle: false,
  repeat: "off",
}));
vi.mock("@/contexts/PlayerContext", () => ({
  usePlayerState: () => state,
  usePlayerActions: () => ({
    toggle: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    toggleShuffle: vi.fn(),
    cycleRepeat: vi.fn(),
  }),
}));
vi.mock("@/contexts/I18nContext", () => ({
  useT: () => (key: TranslationKey, values?: TranslationValues) =>
    translateWith(ru, "ru", key, values),
}));

function transport(shuffle: boolean, repeat: string, size: "full" | "bar" = "full") {
  Object.assign(state, { shuffle, repeat });
  return renderToStaticMarkup(<PlayerTransport size={size} />);
}

describe("persistent playback modes", () => {
  it.each(["off", "all", "one"])(
    "exposes repeat=%s and shuffle to assistive technology",
    (repeat) => {
      const markup = transport(true, repeat);
      expect(markup).toContain('aria-label="Перемешать" aria-pressed="true"');
      expect(markup).toContain(`aria-pressed="${repeat !== "off"}"`);
      expect(markup).toContain(repeat === "one" ? "lucide-repeat-1" : "lucide-repeat");
      expect(markup.match(/class="[^"]*player-mode/g)).toHaveLength(2);
    },
  );

  // Opt-in artifact uses the actual components and production CSS, with no app route or account.
  it.skipIf(!process.env.CAIMACK_THEME_REVIEW_DIR)("exports controls for browser review", () => {
    const modes = [transport(false, "off"), transport(true, "all"), transport(true, "one")];
    const surfaces = [
      null,
      { lightness: 0.1, chroma: 0.1, hue: 260 },
      { lightness: 0.95, chroma: 0.2, hue: 50 },
      { lightness: 0.7, chroma: 0.3, hue: 0 },
      { lightness: 0.6, chroma: 0.3, hue: 140 },
      { lightness: 0.5, chroma: 0.3, hue: 260 },
    ];
    const covers = surfaces.map(
      (tone) => `rgb(${backdropRgb(playerBackdropSurface(tone).top).join(" ")})`,
    );
    const search = renderToStaticMarkup(<SearchTabs tab="tracks" onSelect={() => {}} />);
    const disabled = renderToStaticMarkup(
      <Button variant="ghost" disabled>
        Недоступно
      </Button>,
    );
    const html = `<!doctype html><html lang="ru" data-colorway="coffee" data-theme="dark"><meta charset="utf-8">
      <title>Caimack theme review</title><link rel="stylesheet" href="production.css">
      <style>body{overflow:auto;padding:24px;font-family:Arial,sans-serif} main{max-width:1000px;margin:auto}
      section{padding:20px;margin:16px 0;border-radius:8px}h1{font-size:22px;margin-bottom:16px}
      .states{display:flex;gap:24px;align-items:center;flex-wrap:wrap}.cover{padding:16px;margin:12px 0}
      [data-player-fullscreen]{position:relative;padding:16px}.player-transport{width:300px}
      </style><main><h1>Вкладки поиска и состояния управления</h1>${search}
      <section style="background:var(--card)"><h2>Поверхности и состояния</h2><div class="states">${modes.join("")}${disabled}</div>
      <p style="color:var(--muted-foreground)">Исполнитель · Альбом · Вторичный текст</p>
      <p style="color:var(--faint-foreground)">Длительность · Дополнительные сведения</p></section>
      <section data-player-fullscreen="true"><h2>Плеер: выключено / очередь / один трек</h2>
      ${covers.map((cover) => `<div class="cover" style="background:${cover}"><div class="states">${modes.join("")}</div></div>`).join("")}</section></main></html>`;
    mkdirSync(process.env.CAIMACK_THEME_REVIEW_DIR!, { recursive: true });
    writeFileSync(`${process.env.CAIMACK_THEME_REVIEW_DIR}/index.html`, html);
  });
});

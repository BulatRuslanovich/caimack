// SPDX-License-Identifier: AGPL-3.0-only
import type { Locale } from "@/lib/i18n";

const en = {
  title: "Cats & music",
  description: "Dancing cats to your current track.",
  open: "Show the dancing cats",
  hide: "Hide the cat",
  close: "Close slideshow",
  invite: "A little more dancing?",
  play: "Play music",
  pause: "Pause music",
  previous: "Previous track",
  next: "Next track",
  automatic: "Auto",
  automaticLabel: "Change cats automatically",
  cat: "Show cat",
  noTrack: "Choose a track in the player",
  buffering: "Loading music…",
  paused: "Paused",
  muted: "Sound off",
  reduced: "Reduced motion",
  escape: "Esc to close",
};
const ru: typeof en = {
  title: "Коты под музыку",
  description: "Танцующие коты под текущий трек.",
  open: "Открыть танцующих котов",
  hide: "Спрятать кота",
  close: "Закрыть слайд-шоу",
  invite: "Немного танцев?",
  play: "Включить музыку",
  pause: "Приостановить музыку",
  previous: "Предыдущий трек",
  next: "Следующий трек",
  automatic: "Авто",
  automaticLabel: "Автоматически менять котов",
  cat: "Показать кота",
  noTrack: "Выбери трек в плеере",
  buffering: "Загружаем музыку…",
  paused: "Пауза",
  muted: "Звук выключен",
  reduced: "Движение уменьшено",
  escape: "Esc — закрыть",
};
export function catDanceCopy(locale: Locale) {
  return locale === "ru" ? ru : en;
}

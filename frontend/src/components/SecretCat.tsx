"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { isTypingTarget } from "@/lib/shortcuts";

const TRIGGER = "meow";

export function SecretCat() {
  const [visible, setVisible] = useState(false);
  const buffer = useRef("");
  const lastKey = useRef(0);
  const { locale } = useI18n();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setVisible(false);
        return;
      }
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat ||
        event.isComposing ||
        isTypingTarget(event.target)
      )
        return;
      if (document.querySelector("[role='dialog'], [role='alertdialog']")) return;
      if (event.key.length !== 1) return;
      const now = Date.now();
      buffer.current = (
        (now - lastKey.current > 1500 ? "" : buffer.current) + event.key.toLowerCase()
      ).slice(-TRIGGER.length);
      lastKey.current = now;
      if (buffer.current === TRIGGER) {
        buffer.current = "";
        setVisible(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!visible) return null;
  return (
    <button
      type="button"
      aria-label={locale === "ru" ? "Спрятать кота" : "Hide the cat"}
      onClick={() => setVisible(false)}
      className="fixed right-5 bottom-[calc(var(--player-height)+1rem)] z-50 w-40 overflow-hidden rounded-xl border border-border bg-card shadow-pop max-md:right-3 max-md:bottom-[calc(var(--player-height)+var(--mobile-nav-height)+env(safe-area-inset-bottom)+1rem)] max-md:w-28 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4"
    >
      <video
        src="/cat.webm"
        autoPlay
        muted
        loop
        playsInline
        disablePictureInPicture
        className="aspect-square w-full object-cover"
      />
    </button>
  );
}

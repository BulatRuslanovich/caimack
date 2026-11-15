"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { useI18n } from "@/contexts/I18nContext";
import { usePlayerActions, usePlayerState } from "@/contexts/PlayerContext";
import { isTypingTarget } from "@/lib/shortcuts";
import { useMotionVisibility } from "@/lib/useMotionVisibility";
import { catDanceCopy } from "./cat-dance/copy";

const TRIGGER = "meow";
const CatDance = dynamic(() => import("./cat-dance/CatDance").then((module) => module.CatDance), {
  ssr: false,
});

export function SecretCat() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const buffer = useRef("");
  const lastKey = useRef(0);
  const { locale } = useI18n();
  const copy = catDanceCopy(locale);
  const { muted } = usePlayerState();
  const { toggleMute } = usePlayerActions();
  const currentMute = useRef(muted);
  const sequenceMute = useRef<boolean | null>(null);
  const invitationVideo = useRef<HTMLVideoElement>(null);
  const motion = useMotionVisibility();
  useLayoutEffect(() => {
    currentMute.current = muted;
  }, [muted]);
  useEffect(() => {
    const video = invitationVideo.current;
    if (!video) return;
    if (visible && !expanded && motion.visible && !motion.reduced)
      void video.play().catch(() => {});
    else video.pause();
    return () => video.pause();
  }, [visible, expanded, motion.visible, motion.reduced]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!expanded) setVisible(false);
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
      // The first letter also matches the player's M shortcut. Completing the secret word
      // restores the state from before typing it; a standalone M keeps working normally.
      if (event.key.toLowerCase() === "m") sequenceMute.current = currentMute.current;
      buffer.current = (
        (now - lastKey.current > 1500 ? "" : buffer.current) + event.key.toLowerCase()
      ).slice(-TRIGGER.length);
      lastKey.current = now;
      if (buffer.current === TRIGGER) {
        buffer.current = "";
        if (sequenceMute.current !== null && sequenceMute.current !== currentMute.current)
          toggleMute();
        sequenceMute.current = null;
        setVisible(true);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [expanded, toggleMute]);

  if (!visible) return null;
  if (expanded)
    return (
      <CatDance
        onClose={() => {
          setExpanded(false);
          setVisible(false);
        }}
      />
    );
  return (
    <div className="secret-cat-invite">
      <button
        type="button"
        className="secret-cat-dismiss"
        aria-label={copy.hide}
        onClick={() => setVisible(false)}
      >
        <X size={15} />
      </button>
      <button
        type="button"
        aria-label={copy.open}
        onClick={() => setExpanded(true)}
        className="secret-cat-open"
      >
        <video
          ref={invitationVideo}
          src="/cats/01.webm"
          poster="/cats/01.jpg"
          muted
          loop
          playsInline
          disablePictureInPicture
          className="aspect-square w-full object-cover"
        />
        <span>{copy.invite}</span>
      </button>
    </div>
  );
}

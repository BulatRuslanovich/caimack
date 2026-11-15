// SPDX-License-Identifier: AGPL-3.0-only
"use client";
import { useSyncExternalStore } from "react";

function subscribeMotion(update: () => void) {
  const query = matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", update);
  return () => query.removeEventListener("change", update);
}
function subscribeVisibility(update: () => void) {
  document.addEventListener("visibilitychange", update);
  return () => document.removeEventListener("visibilitychange", update);
}
const motionSnapshot = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const visibilitySnapshot = () => document.visibilityState === "visible";
const serverMotion = () => true;
const serverVisibility = () => false;

export function useMotionVisibility() {
  const reduced = useSyncExternalStore(subscribeMotion, motionSnapshot, serverMotion);
  const visible = useSyncExternalStore(subscribeVisibility, visibilitySnapshot, serverVisibility);
  return { reduced, visible };
}

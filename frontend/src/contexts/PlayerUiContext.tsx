// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { readStored, writeStored } from "@/lib/storage";

const PIN_KEY = "music-streaming.queue-pinned";
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const pinned = () => readStored(PIN_KEY) === "on";
const wideQuery = "(min-width: 1280px)";
const subscribeWide = (listener: () => void) => {
  const media = window.matchMedia(wideQuery);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};
const isWide = () => window.matchMedia(wideQuery).matches;

interface PlayerUi {
  queueOpen: boolean;
  setQueueOpen: Dispatch<SetStateAction<boolean>>;
  queuePinned: boolean;
  setQueuePinned: (value: boolean) => void;
  queueDocked: boolean;
}

const Context = createContext<PlayerUi | null>(null);

export function PlayerUiProvider({ children }: { children: ReactNode }) {
  const queuePinned = useSyncExternalStore(subscribe, pinned, () => false);
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const [open, setOpen] = useState<boolean | null>(null);
  const queueOpen = open ?? (queuePinned && wide);
  const setQueueOpen: Dispatch<SetStateAction<boolean>> = (value) =>
    setOpen((previous) =>
      typeof value === "function" ? value(previous ?? (queuePinned && wide)) : value,
    );
  const setQueuePinned = (value: boolean) => {
    setOpen(true);
    writeStored(PIN_KEY, value ? "on" : "off");
    for (const listener of listeners) listener();
  };

  return (
    <Context.Provider
      value={{
        queueOpen,
        setQueueOpen,
        queuePinned,
        setQueuePinned,
        queueDocked: queueOpen && queuePinned && wide,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function usePlayerUi() {
  const context = useContext(Context);
  if (!context) throw new Error("PlayerUiProvider is missing");
  return context;
}

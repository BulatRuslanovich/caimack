// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

"use client";

import { api } from "@/lib/api";
import { onSessionExpired, refreshSession } from "@/lib/http";
import { describeDevice } from "@/lib/playback/deviceName";
import { queries } from "@/lib/queries";
import { cacheAppShell, clearStreamCache } from "@/lib/serviceWorker";
import { readSessionHint } from "@/lib/session/sessionHint";
import { renewalIntervalMs } from "@/lib/session/sessionRenewal";
import type { User } from "@/lib/types";
import { useRequiredContext } from "@/lib/useRequiredContext";
import { useTimeZoneSync } from "@/lib/useTimeZoneSync";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  register: (token: string, username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

let cachedHint: User | null = null;

function hintSnapshot(): User | null {
  cachedHint ??= readSessionHint();
  return cachedHint;
}

function subscribeToHint(): () => void {
  return () => {};
}

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: React.ReactNode;
  initialUser?: User | null;
}) {
  const hint = useSyncExternalStore(subscribeToHint, hintSnapshot, () => initialUser);

  const [resolved, setResolved] = useState<{ user: User | null } | null>(null);
  const router = useRouter();
  const client = useQueryClient();

  const user = resolved ? resolved.user : hint;
  useTimeZoneSync(user?.id ?? null);
  const loading = resolved === null && hint === null;

  const config = useQuery({ ...queries.config(), enabled: user !== null });
  useSessionRenewal(user !== null, config.data?.accessTokenMinutes ?? 0);

  useEffect(() => {
    let cancelled = false;

    api
      .me()
      .then((me) => {
        if (!cancelled) setResolved({ user: me });
      })
      .catch(() => {
        if (!cancelled) {
          setResolved({ user: navigator.onLine ? null : hint });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hint]);

  useEffect(
    () =>
      onSessionExpired(() => {
        cachedHint = null;
        void clearStreamCache().catch(() => {});
        client.clear();
        setResolved({ user: null });
        router.replace("/login");
      }),
    [client, router],
  );

  useEffect(() => {
    if (user) void cacheAppShell();
  }, [user]);

  const signIn = useCallback(async (username: string, password: string) => {
    setResolved({ user: await api.login(username, password, describeDevice(navigator.userAgent)) });
  }, []);

  const register = useCallback(async (token: string, username: string, password: string) => {
    const deviceName = describeDevice(navigator.userAgent);
    setResolved({ user: await api.register({ token, username, password, deviceName }) });
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      await clearStreamCache().catch(() => {});
      cachedHint = null;
      client.clear();

      setResolved({ user: null });
      router.replace("/login");
    }
  }, [client, router]);

  const value = useMemo<AuthState>(
    () => ({ user, isAdmin: user?.isAdmin ?? false, loading, signIn, register, signOut }),
    [user, loading, signIn, register, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useRequiredContext(AuthContext, "useAuth", "AuthProvider");
}

function useSessionRenewal(signedIn: boolean, accessTokenMinutes: number): void {
  useEffect(() => {
    if (!signedIn || accessTokenMinutes <= 0) return;

    const intervalMs = renewalIntervalMs(accessTokenMinutes);
    let lastRenewedAt = Date.now();

    const renew = () => {
      lastRenewedAt = Date.now();
      void refreshSession();
    };

    const timer = window.setInterval(renew, intervalMs);

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRenewedAt >= intervalMs) renew();
    };

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [signedIn, accessTokenMinutes]);
}

// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isDesktop } from "@/desktop/runtime";
import { integrations } from "./generated";

export function useAvailableIntegrations() {
  const { isAdmin, supportedIntegrations } = useAuth();
  if (!isAdmin) return [];
  return integrations.filter(
    ({ id, webOnly }) => !(isDesktop && webOnly) && supportedIntegrations?.includes(id),
  );
}

function subscribe(listener: () => void) {
  const unsubscribe = integrations.map(({ preference }) => preference.subscribe(listener));
  return () => unsubscribe.forEach((remove) => remove());
}

function enabledSnapshot() {
  return integrations
    .filter(({ preference }) => preference.read())
    .map(({ id }) => id)
    .join(" ");
}

export function useEnabledIntegrations() {
  const available = useAvailableIntegrations();
  const enabled = useSyncExternalStore(subscribe, enabledSnapshot, () => "").split(" ");
  return available.filter(({ id }) => enabled.includes(id));
}

export function IntegrationRuntime({ children }: { children: ReactNode }) {
  const available = useAvailableIntegrations();
  return integrations.reduceRight(
    (content, { id, Runtime }) =>
      Runtime ? (
        <Runtime key={id} available={available.some((entry) => entry.id === id)}>
          {content}
        </Runtime>
      ) : (
        content
      ),
    children,
  );
}

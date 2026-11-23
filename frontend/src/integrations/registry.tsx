// SPDX-License-Identifier: AGPL-3.0-only

"use client";

import { type ReactNode } from "react";
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

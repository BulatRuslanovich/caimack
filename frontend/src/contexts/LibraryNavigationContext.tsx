// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { catalogNav, isLibraryBrowsePath, type LibraryBrowsePath } from "@/lib/navigation";
import { navigationPrefetch, prepareLibraryView } from "@/lib/queries";
import { scrollContentToTop } from "@/lib/scroll";

const LibraryNavigationContext = createContext<{
  navigate: (href: LibraryBrowsePath) => Promise<void>;
  pendingHref: LibraryBrowsePath | null;
} | null>(null);
export const useLibraryNavigation = () => useContext(LibraryNavigationContext);

export function LibraryNavigationProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const inWorkspace = isLibraryBrowsePath(usePathname());
  const [pendingHref, setPendingHref] = useState<LibraryBrowsePath | null>(null);
  const latestRequest = useRef(0);

  useEffect(() => {
    if (!inWorkspace) return;

    const timer = window.setTimeout(() => {
      void navigationPrefetch["/library"](client);
      for (const { href } of catalogNav) void navigationPrefetch[href](client);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [client, inWorkspace]);

  useEffect(() => {
    const cancelPending = () => {
      latestRequest.current += 1;
      setPendingHref(null);
    };
    window.addEventListener("popstate", cancelPending);
    return () => {
      latestRequest.current += 1;
      window.removeEventListener("popstate", cancelPending);
    };
  }, []);

  const navigate = useCallback(
    async (href: LibraryBrowsePath) => {
      const request = ++latestRequest.current;
      const origin = window.location.href;
      if (window.location.pathname === href && !window.location.search) {
        setPendingHref(null);
        return;
      }

      setPendingHref(href);
      try {
        // Keep the current view visible until the destination can render its list.
        await prepareLibraryView(client, href);
      } catch {
        // The query cache reports the error while the current view stays usable.
        return;
      } finally {
        if (request === latestRequest.current) setPendingHref(null);
      }

      if (request === latestRequest.current && origin === window.location.href) {
        window.history.pushState(null, "", href);
        scrollContentToTop();
      }
    },
    [client],
  );

  const navigation = useMemo(() => ({ navigate, pendingHref }), [navigate, pendingHref]);

  return (
    <LibraryNavigationContext.Provider value={inWorkspace ? navigation : null}>
      {children}
    </LibraryNavigationContext.Provider>
  );
}

// SPDX-License-Identifier: AGPL-3.0-only
import { useMemo, useSyncExternalStore } from "react";
import { scrollContentToTop } from "@/lib/scroll";

const navigationEvent = "caimack:navigate";

export function installNavigation() {
  for (const method of ["pushState", "replaceState"] as const) {
    const change = history[method].bind(history);
    history[method] = (data: unknown, unused: string, url?: string | URL | null) => {
      change(data, unused, url);
      window.dispatchEvent(new Event(navigationEvent));
    };
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(navigationEvent, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(navigationEvent, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function useSearchParams() {
  const search = useSyncExternalStore(subscribe, () => location.search);
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useSelectedLayoutSegment() {
  return usePathname().split("/")[1] || null;
}

export function useParams<T = Record<string, string>>(): T {
  const pathname = usePathname();
  return useMemo(() => {
    const [, route, raw = ""] = pathname.split("/");
    let value = raw;
    try {
      value = decodeURIComponent(raw);
    } catch {}
    const key = route === "mixes" ? "kind" : route === "invite" ? "token" : "id";
    return { [key]: value } as T;
  }, [pathname]);
}

export function navigate(href: string, replace = false, scroll = true) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || url.href === location.href) return;
  const changedPage = url.pathname !== location.pathname;
  history[replace ? "replaceState" : "pushState"](null, "", url);
  if (changedPage && scroll) scrollContentToTop();
}

const router = {
  push: (href: string, options?: { scroll?: boolean }) => navigate(href, false, options?.scroll),
  replace: (href: string, options?: { scroll?: boolean }) => navigate(href, true, options?.scroll),
};

export function useRouter() {
  return router;
}

export function notFound(): never {
  throw new Error("Page not found");
}

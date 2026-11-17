// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { createContext, useContext } from "react";
import type { Route } from "next";

export const LibraryNavigationContext = createContext<((href: Route) => void) | null>(null);
export const useLibraryNavigation = () => useContext(LibraryNavigationContext);

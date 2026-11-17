// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";
import { LibraryWorkspace } from "@/components/LibraryWorkspace";

export default function Layout({ children }: { children: ReactNode }) {
  return <LibraryWorkspace>{children}</LibraryWorkspace>;
}

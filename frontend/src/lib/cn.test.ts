// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { cn } from "./cn";

it("keeps the track title size when it gets a selected colour", () => {
  expect(cn("truncate text-body font-semibold", "text-primary")).toBe(
    "truncate text-body font-semibold text-primary",
  );
  expect(cn("text-faint text-2xs", "text-sm")).toBe("text-faint text-sm");
});

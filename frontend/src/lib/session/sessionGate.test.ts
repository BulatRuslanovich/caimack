// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 Bulat Ruslanovich

import { describe, expect, it } from "vitest";
import { sessionGate } from "@/lib/session/sessionGate";

const alive = { renewal: "unavailable", hasRefreshCookie: true, hasSessionHint: true } as const;

describe("sessionGate", () => {
  it("lets in someone whose session was just renewed", () => {
    expect(sessionGate({ ...alive, renewal: "renewed" })).toBe("signedIn");

    expect(
      sessionGate({ renewal: "renewed", hasRefreshCookie: false, hasSessionHint: false }),
    ).toBe("signedIn");
  });

  it("lets in on a refresh cookie plus a hint when there is nothing to renew", () => {
    expect(sessionGate(alive)).toBe("signedIn");
  });

  it("does not trust a hint left without a refresh cookie", () => {
    expect(
      sessionGate({ renewal: "unavailable", hasRefreshCookie: false, hasSessionHint: true }),
    ).toBe("signedOut");
  });

  it("calls the session ended when the backend rejected the renewal", () => {
    expect(sessionGate({ ...alive, renewal: "rejected" })).toBe("sessionEnded");
  });

  it("survives an unreachable backend without signing anyone out", () => {
    expect(sessionGate({ ...alive, renewal: "unavailable" })).toBe("signedIn");
  });

  it("keeps out someone who has nothing", () => {
    expect(
      sessionGate({ renewal: "unavailable", hasRefreshCookie: false, hasSessionHint: false }),
    ).toBe("signedOut");
  });

  it("keeps out a refresh cookie with no hint", () => {
    expect(
      sessionGate({ renewal: "unavailable", hasRefreshCookie: true, hasSessionHint: false }),
    ).toBe("signedOut");
  });
});

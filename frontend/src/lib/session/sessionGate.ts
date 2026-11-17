// SPDX-License-Identifier: AGPL-3.0-only

type RenewalStatus = "renewed" | "rejected" | "unavailable";

type SessionGate = "signedIn" | "signedOut" | "sessionEnded";

export function sessionGate({
  renewal,
  hasRefreshCookie,
  hasSessionHint,
}: {
  renewal: RenewalStatus;
  hasRefreshCookie: boolean;
  hasSessionHint: boolean;
}): SessionGate {
  if (renewal === "renewed") return "signedIn";
  if (renewal === "rejected") return "sessionEnded";

  return hasRefreshCookie && hasSessionHint ? "signedIn" : "signedOut";
}

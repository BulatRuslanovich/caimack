// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookies, headers } from "next/headers";
import { prefetchOnServer } from "./prefetch";
import { requestContext } from "./requestContext";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

beforeEach(() => {
  vi.mocked(headers).mockResolvedValue(new Headers({ "sec-fetch-dest": "document" }) as never);
  vi.mocked(cookies).mockResolvedValue({ toString: () => "session=test" } as never);
  vi.clearAllMocks();
});

describe("catalog navigation prefetch", () => {
  it("keeps authenticated server data in the initial document", async () => {
    const state = await prefetchOnServer(
      async (client) => {
        expect(requestContext.getStore()?.cookie).toBe("session=test");
        await client.prefetchQuery({ queryKey: ["catalog"], queryFn: () => ["album"] });
      },
      { initialOnly: true },
    );
    expect(state.queries[0]?.state.data).toEqual(["album"]);
  });

  it("does not wait for the backend or serialize another catalog during client navigation", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers({ "sec-fetch-dest": "empty" }) as never);
    const backend = vi.fn(() => new Promise<never>(() => {}));
    const state = await prefetchOnServer(backend, { initialOnly: true });
    expect(state.queries).toEqual([]);
    expect(backend).not.toHaveBeenCalled();
    expect(cookies).not.toHaveBeenCalled();
  });

  it("retains server prefetch for routes that have not opted into initial-only loading", async () => {
    vi.mocked(headers).mockResolvedValue(new Headers({ "sec-fetch-dest": "empty" }) as never);
    const backend = vi.fn(async () => {});
    await prefetchOnServer(backend);
    expect(backend).toHaveBeenCalledOnce();
  });
});

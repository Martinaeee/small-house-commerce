import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "luwag_order_receipt" && state.token ? { value: state.token } : undefined),
  }),
}));

import { fetchOrderReceipt } from "./order-receipt";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  state.token = null;
  vi.stubEnv("API_TARGET", "http://backend:3000");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

function fetchResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe("fetchOrderReceipt", () => {
  it("never calls the backend without the receipt cookie", async () => {
    const fetcher = vi.fn();
    globalThis.fetch = fetcher as unknown as typeof fetch;

    await expect(fetchOrderReceipt("PH100030")).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("forwards the HttpOnly cookie and returns the order state", async () => {
    state.token = "signed.receipt";
    const fetcher = vi.fn(async () =>
      fetchResponse(200, { ok: true, placedAt: "2026-11-09T06:00:00Z" }),
    );
    globalThis.fetch = fetcher as unknown as typeof fetch;

    await expect(fetchOrderReceipt("PH100030")).resolves.toEqual({
      ok: true,
      placedAt: "2026-11-09T06:00:00Z",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://backend:3000/api/v1/storefront/orders/PH100030/receipt",
      expect.objectContaining({
        cache: "no-store",
        headers: { cookie: "luwag_order_receipt=signed.receipt" },
      }),
    );
  });

  it("encodes the order number so it cannot escape the receipt path", async () => {
    state.token = "signed.receipt";
    const fetcher = vi.fn(async (_url: RequestInfo | URL) => fetchResponse(404, { message: "Not Found" }));
    globalThis.fetch = fetcher as unknown as typeof fetch;

    await fetchOrderReceipt("../PH100999/other");

    const url = String(fetcher.mock.calls[0]![0]);
    expect(url).toContain("%2FPH100999%2Fother/receipt");
    expect(url).not.toContain("/../");
  });

  it("treats a rejected, malformed or non-ok response as no receipt", async () => {
    state.token = "signed.receipt";

    for (const response of [
      () => fetchResponse(404, { message: "Not Found" }),
      () => fetchResponse(200, { ok: false }),
      () => fetchResponse(200, { ok: true, placedAt: 42 }),
      () => Promise.resolve({ ok: true, json: async () => { throw new Error("bad json"); } } as unknown as Response),
    ]) {
      globalThis.fetch = vi.fn(response) as unknown as typeof fetch;
      await expect(fetchOrderReceipt("PH100030")).resolves.toBeNull();
    }
  });
});

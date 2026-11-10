import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiTimeoutError } from "./api";
import { PLACE_ORDER_RESPONSE_BUDGET_MS } from "./checkout-submission";

afterEach(() => {
  vi.unstubAllGlobals();
});

const CUSTOMER = {
  name: "Ana Cruz",
  phone: "09171234567",
  province: "Metro Manila",
  city: "Quezon City",
  barangay: null,
  postalCode: null,
  streetAddress: "12 Mabini St.",
  landmark: null,
};

describe("api.createOrder", () => {
  it("forwards the checkout draft token so the order can convert it", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            orderNumber: "PH100020",
            orderStatus: "NEW",
            confirmationStatus: "UNCONFIRMED",
            grandTotal: 1299,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.createOrder({
      customer: CUSTOMER,
      items: [{ skuId: "11111111-1111-4111-8111-111111111111", quantity: 1 }],
      attribution: { sourceType: "ORGANIC" },
      checkoutDraftToken: "mw0abc.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.checkoutDraftToken).toBe(
      "mw0abc.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });
});

describe("api.createOrder deadline", () => {
  it("gives the order request its own response budget and reports a timeout, not a rejection", async () => {
    vi.useFakeTimers();
    try {
      // A flaky mobile connection leaves the request hanging; it never answers.
      const fetchMock = vi.fn(
        (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Promise<Response>(() => undefined),
      );
      vi.stubGlobal("fetch", fetchMock);

      const pending = api
        .createOrder({
          customer: CUSTOMER,
          items: [{ skuId: "11111111-1111-4111-8111-111111111111", quantity: 1 }],
        })
        .catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(PLACE_ORDER_RESPONSE_BUDGET_MS - 1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      const error = await pending;

      expect(error).toBeInstanceOf(ApiTimeoutError);
      expect((error as Error).name).toBe("TimeoutError");
      // The request carried an abort signal so a dropped socket is released.
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("api.checkoutAttemptStatus", () => {
  it("asks whether the attempt produced an order, sending the key in the body", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ state: "PENDING" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await api.checkoutAttemptStatus("3f2504e0-4f89-41d3-9a0c-0305e82c3301");

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/storefront/orders/attempt-status");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ idempotencyKey: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" });
  });

  it("returns the ordered state without logging the key in the URL", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            state: "ORDERED",
            orderNumber: "PH3001",
            orderStatus: "NEW",
            grandTotal: 199,
            placedAt: "2026-11-09T06:00:00.000Z",
            items: [{ skuId: "sku-1", quantity: 1 }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const status = await api.checkoutAttemptStatus("key-1234567890123456");
    expect(status).toMatchObject({ state: "ORDERED", orderNumber: "PH3001" });
  });
});

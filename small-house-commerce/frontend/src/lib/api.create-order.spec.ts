import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

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

import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("newsletter promo transport", () => {
  it("sends the promo code at the order root and defaults it to null", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse({ orderNumber: "PH1" }));
    vi.stubGlobal("fetch", fetchMock);
    const base = {
      customer: {
        name: "Jane",
        phone: "09171234567",
        province: "Metro Manila",
        city: "Manila",
        streetAddress: "1 Main St",
      },
      items: [{ skuId: "sku-1", quantity: 1 }],
    };

    await api.createOrder({ ...base, promoCode: "WELCOME59" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).promoCode).toBe(
      "WELCOME59",
    );

    await api.createOrder(base);
    expect(
      JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).promoCode,
    ).toBeNull();
  });

  it("previews a code against the checkout promo endpoint", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ valid: true, discountAmount: 59, message: "" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.previewPromoCode("welcome59", 1299)).resolves.toEqual({
      valid: true,
      discountAmount: 59,
      message: "",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/storefront/checkout/promo-code/preview"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      code: "welcome59",
      subtotal: 1299,
    });
  });
});

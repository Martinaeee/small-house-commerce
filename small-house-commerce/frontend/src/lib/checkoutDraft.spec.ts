import { beforeEach, describe, expect, it } from "vitest";
import { readCheckoutDraft, writeCheckoutDraft } from "./checkoutDraft";

beforeEach(() => {
  sessionStorage.clear();
});

describe("checkout draft", () => {
  it("round-trips a PDP inline multi-item selection with the customer", () => {
    writeCheckoutDraft(
      {
        name: "Juan Dela Cruz",
        phone: "09171234567",
        province: "Metro Manila",
        city: "Quezon City",
        barangay: "Diliman",
        postalCode: "1101",
        streetAddress: "12 Mabini St",
        landmark: "Blue gate",
      },
      "2026-10-05",
      {
        kind: "PDP_INLINE",
        productSlug: "chair",
        productQuery: "?aid=aid-123&utm_source=facebook",
        items: [
          { skuId: "sku-red", quantity: 1 },
          { skuId: "sku-blue", quantity: 2 },
        ],
      },
    );

    expect(readCheckoutDraft()).toMatchObject({
      customer: { postalCode: "1101" },
      preferredDeliveryDate: "2026-10-05",
      selection: {
        kind: "PDP_INLINE",
        productSlug: "chair",
        productQuery: "?aid=aid-123&utm_source=facebook",
        items: [
          { skuId: "sku-red", quantity: 1 },
          { skuId: "sku-blue", quantity: 2 },
        ],
      },
      savedAt: expect.any(String),
    });
  });

  it("rejects a malformed PDP selection at the session-storage boundary", () => {
    sessionStorage.setItem(
      "luwag_checkout_draft",
      JSON.stringify({
        customer: {
          name: "Juan Dela Cruz",
          phone: "09171234567",
          province: "Metro Manila",
          city: "Quezon City",
          barangay: "",
          postalCode: "1100",
          streetAddress: "12 Mabini St",
          landmark: "",
        },
        preferredDeliveryDate: null,
        savedAt: "2026-09-27T00:00:00.000Z",
        selection: {
          kind: "PDP_INLINE",
          productSlug: "chair",
          items: "not-an-array",
        },
      }),
    );

    expect(readCheckoutDraft()).toBeNull();
  });
});

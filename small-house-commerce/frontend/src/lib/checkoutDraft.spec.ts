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

const customer = {
  name: "Jane Cruz",
  phone: "09171234567",
  province: "Metro Manila",
  city: "Manila",
  barangay: "Barangay 1",
  postalCode: "1100",
  streetAddress: "1 Main St",
  landmark: "Blue gate",
};

describe("checkout draft order note", () => {
  it("round-trips the note through write and read", () => {
    writeCheckoutDraft(customer, null, undefined, "Call before delivery");
    expect(readCheckoutDraft()?.customerNote).toBe("Call before delivery");
  });

  it("stores null when the caller omits the note", () => {
    writeCheckoutDraft(customer, null);
    expect(readCheckoutDraft()?.customerNote).toBeNull();
  });

  it("loads a legacy draft written before the field existed", () => {
    sessionStorage.setItem(
      "luwag_checkout_draft",
      JSON.stringify({ customer, savedAt: "2026-10-01T00:00:00.000Z" }),
    );
    const draft = readCheckoutDraft();
    expect(draft?.customerNote).toBeNull();
    expect(draft?.customer.name).toBe("Jane Cruz");
  });

  it("coerces a non-string stored note instead of dropping the draft", () => {
    sessionStorage.setItem(
      "luwag_checkout_draft",
      JSON.stringify({ customer, savedAt: "x", customerNote: 42 }),
    );
    expect(readCheckoutDraft()?.customerNote).toBeNull();
  });

  it("truncates an over-long stored note and keeps the rest of the draft", () => {
    sessionStorage.setItem(
      "luwag_checkout_draft",
      JSON.stringify({ customer, savedAt: "x", customerNote: "x".repeat(400) }),
    );
    const draft = readCheckoutDraft();
    expect(draft?.customerNote).toHaveLength(200);
    expect(draft?.customer.phone).toBe("09171234567");
  });

  it("treats a whitespace-only stored note as unfilled", () => {
    sessionStorage.setItem(
      "luwag_checkout_draft",
      JSON.stringify({ customer, savedAt: "x", customerNote: "   " }),
    );
    expect(readCheckoutDraft()?.customerNote).toBeNull();
  });

  it("round-trips a normalized promo code", () => {
    writeCheckoutDraft(customer, null, undefined, null, "  welcome10 ");
    expect(readCheckoutDraft()?.promoCode).toBe("WELCOME10");
  });

  it("stores null when no promo code is given", () => {
    writeCheckoutDraft(customer);
    expect(readCheckoutDraft()?.promoCode).toBeNull();
  });

  it("treats a legacy draft without a promo code as unfilled", () => {
    sessionStorage.setItem(
      "luwag_checkout_draft",
      JSON.stringify({ customer, savedAt: "x" }),
    );
    expect(readCheckoutDraft()?.promoCode).toBeNull();
  });

  it("coerces a malformed stored promo code instead of dropping the draft", () => {
    sessionStorage.setItem(
      "luwag_checkout_draft",
      JSON.stringify({ customer, savedAt: "x", promoCode: 42 }),
    );
    const draft = readCheckoutDraft();
    expect(draft?.promoCode).toBeNull();
    expect(draft?.customer.name).toBe("Jane Cruz");
  });

  it("truncates an over-long stored promo code", () => {
    sessionStorage.setItem(
      "luwag_checkout_draft",
      JSON.stringify({ customer, savedAt: "x", promoCode: "X".repeat(80) }),
    );
    expect(readCheckoutDraft()?.promoCode).toHaveLength(32);
  });
});

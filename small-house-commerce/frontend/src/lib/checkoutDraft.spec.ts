import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkoutDraftStorageBlocked,
  clearCheckoutDraft,
  readCheckoutDraft,
  writeCheckoutDraft,
} from "./checkoutDraft";

beforeEach(() => {
  clearCheckoutDraft();
  sessionStorage.clear();
});

describe("checkout draft order note", () => {
  const customer = {
    name: "Juan Dela Cruz",
    phone: "09171234567",
    province: "Metro Manila",
    city: "Quezon City",
    barangay: "",
    postalCode: "1100",
    streetAddress: "12 Mabini St",
    landmark: "",
  };

  it("round-trips a trimmed note", () => {
    writeCheckoutDraft(customer, null, undefined, null, "  Please call before delivery  ");
    expect(readCheckoutDraft()?.customerNote).toBe("Please call before delivery");
  });

  it("stores no note for a blank one", () => {
    writeCheckoutDraft(customer, null, undefined, null, "   ");
    expect(readCheckoutDraft()?.customerNote).toBeNull();
  });

  it("never keeps more than the order API accepts", () => {
    writeCheckoutDraft(customer, null, undefined, null, "x".repeat(260));
    expect(readCheckoutDraft()?.customerNote).toHaveLength(200);
  });
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

  it("round-trips and normalizes an applied promo code", () => {
    writeCheckoutDraft(
      {
        name: "Juan Dela Cruz",
        phone: "09171234567",
        province: "Metro Manila",
        city: "Quezon City",
        barangay: "",
        postalCode: "1100",
        streetAddress: "12 Mabini St",
        landmark: "",
      },
      null,
      undefined,
      "  welcome59  ",
    );

    expect(readCheckoutDraft()?.promoCode).toBe("WELCOME59");
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

/**
 * F05: private mode or a full storage quota must not throw away the details
 * the shopper just typed between the form and confirmation steps.
 */
describe("checkout draft without usable session storage", () => {
  const customer = {
    name: "Ana Cruz",
    phone: "09171234567",
    province: "Metro Manila",
    city: "Quezon City",
    barangay: "",
    postalCode: "1100",
    streetAddress: "12 Mabini St",
    landmark: "",
  };

  function denyStorage() {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage);
  }

  it("keeps the draft in memory when storage refuses the write", () => {
    denyStorage();
    try {
      writeCheckoutDraft(customer, "2026-11-12", undefined, null, "Call first");
      const draft = readCheckoutDraft();
      expect(draft?.customer.name).toBe("Ana Cruz");
      expect(draft?.customerNote).toBe("Call first");
      expect(checkoutDraftStorageBlocked()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not resurrect the draft after it is cleared", () => {
    denyStorage();
    try {
      writeCheckoutDraft(customer);
      clearCheckoutDraft();
      expect(readCheckoutDraft()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports usable storage when it is usable", () => {
    expect(checkoutDraftStorageBlocked()).toBe(false);
  });
});

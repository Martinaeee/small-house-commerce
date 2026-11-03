import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkoutAttemptKey,
  clearAutosave,
  createCheckoutDraftToken,
  readAutosave,
  resolveCheckoutAttempt,
  writeAutosave,
  type CheckoutAutosaveSnapshot,
} from "./checkoutAutosave";

const SNAPSHOT: CheckoutAutosaveSnapshot = {
  customer: {
    name: "Ana",
    phone: "0917",
    province: "",
    city: "",
    barangay: "",
    postalCode: "",
    streetAddress: "",
    landmark: "",
  },
  items: [],
  preferredDeliveryDate: null,
  promoCodeInput: "",
  promoCodeApplied: null,
  customerNote: "",
};

describe("checkoutAttemptKey", () => {
  it("separates buy-now from the cart and is stable across review", () => {
    expect(checkoutAttemptKey({ skuId: "sku-1", qty: "2", slug: "chair" })).toBe(
      "buy:sku-1:2:chair",
    );
    expect(checkoutAttemptKey({ itemsParam: "b,a", slug: "chair" })).toBe("cart:a,b");
    expect(checkoutAttemptKey({ slug: "chair" })).toBe("cart:all");
  });
});

describe("checkout draft token", () => {
  it("encodes its creation time and 32 random bytes", () => {
    const now = Date.parse("2026-11-03T00:00:00.000Z");
    const token = createCheckoutDraftToken(now);
    expect(token.split(".")[0]).toBe(now.toString(36));
    expect(token.split(".")[1]).toHaveLength(43);
    expect(createCheckoutDraftToken(now)).not.toBe(token);
  });
});

describe("local autosave", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the token while the same checkout is resumed", () => {
    const first = resolveCheckoutAttempt("cart:a", 1000);
    const second = resolveCheckoutAttempt("cart:a", 2000);
    expect(second.token).toBe(first.token);
  });

  it("starts a new attempt for a different checkout", () => {
    const first = resolveCheckoutAttempt("cart:a", 1000);
    const second = resolveCheckoutAttempt("cart:b", 2000);
    expect(second.token).not.toBe(first.token);
  });

  it("round-trips the last snapshot and clears it", () => {
    const attempt = resolveCheckoutAttempt("cart:a", 1000);
    writeAutosave(attempt, 3, SNAPSHOT);
    expect(readAutosave(attempt)).toEqual({ revision: 3, snapshot: SNAPSHOT });
    clearAutosave(attempt);
    expect(readAutosave(attempt)).toBeNull();
  });

  it("never throws when storage is disabled", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    expect(() =>
      writeAutosave({ token: "x", key: "k", createdAt: 1 }, 1, SNAPSHOT),
    ).not.toThrow();
    expect(readAutosave({ token: "x", key: "k", createdAt: 1 })).toBeNull();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});

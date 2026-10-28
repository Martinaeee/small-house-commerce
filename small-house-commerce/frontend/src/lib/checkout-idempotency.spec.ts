import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkoutIdempotencyKey,
  clearCheckoutIdempotencyKey,
} from "./checkout-idempotency";

const SAFE = /^[A-Za-z0-9_-]{16,120}$/;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("checkout idempotency key", () => {
  it("reuses the key for a retry of the same checkout", () => {
    const first = checkoutIdempotencyKey("/checkout?items=abc");
    const second = checkoutIdempotencyKey("/checkout?items=abc");
    expect(second).toBe(first);
    expect(first).toMatch(SAFE);
  });

  it("uses a different key for a different checkout", () => {
    expect(checkoutIdempotencyKey("/checkout?items=abc")).not.toBe(
      checkoutIdempotencyKey("/checkout?items=xyz"),
    );
  });

  it("replaces a stored value the backend would reject", () => {
    window.sessionStorage.setItem("luwag_checkout_idem:/checkout?items=abc", "bad key");
    const key = checkoutIdempotencyKey("/checkout?items=abc");
    expect(key).not.toBe("bad key");
    expect(key).toMatch(SAFE);
  });

  it("replaces a stored key shorter than the backend minimum", () => {
    const short = "x".repeat(15);
    window.sessionStorage.setItem("luwag_checkout_idem:/checkout?items=abc", short);
    const key = checkoutIdempotencyKey("/checkout?items=abc");
    expect(key).not.toBe(short);
    expect(key).toMatch(SAFE);
  });

  it("clears the completed scope so the next purchase gets a new key", () => {
    const scope = "/checkout?skuId=sku-1&qty=1&slug=chair";
    const first = checkoutIdempotencyKey(scope);
    clearCheckoutIdempotencyKey(scope);
    const second = checkoutIdempotencyKey(scope);
    expect(second).not.toBe(first);
    expect(second).toMatch(SAFE);
  });

  it("clears only the scope that completed", () => {
    const completed = "/checkout?skuId=sku-1&qty=1&slug=chair";
    const other = "/checkout?skuId=sku-2&qty=1&slug=chair";
    const firstCompleted = checkoutIdempotencyKey(completed);
    const firstOther = checkoutIdempotencyKey(other);
    clearCheckoutIdempotencyKey(completed);
    expect(checkoutIdempotencyKey(completed)).not.toBe(firstCompleted);
    expect(checkoutIdempotencyKey(other)).toBe(firstOther);
  });

  it("does not throw when storage denies removal", () => {
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      expect(() => clearCheckoutIdempotencyKey("/checkout")).not.toThrow();
    } finally {
      remove.mockRestore();
    }
  });

  it("still returns a key when sessionStorage is unavailable", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      expect(checkoutIdempotencyKey("/checkout?items=abc")).toMatch(SAFE);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("keeps the no-crypto fallback at the backend minimum length", () => {
    // The third fallback is the only branch that can be shorter than the
    // backend's 16-character minimum when Math.random() returns exactly 0.
    vi.stubGlobal("crypto", {});
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const key = checkoutIdempotencyKey("/checkout?items=abc");
      expect(key.length).toBeGreaterThanOrEqual(16);
      expect(key).toMatch(SAFE);
    } finally {
      random.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkoutIdempotencyAttempt,
  clearCheckoutIdempotencyKey,
} from "./checkout-idempotency";

const SAFE = /^[A-Za-z0-9_-]{16,120}$/;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("checkout idempotency attempt", () => {
  it("reuses the key and submit-time consent for a retry of the same checkout", () => {
    const first = checkoutIdempotencyAttempt("/checkout?items=abc", false);
    const second = checkoutIdempotencyAttempt("/checkout?items=abc", true);

    expect(second).toEqual(first);
    expect(first.key).toMatch(SAFE);
    expect(first.metaConsent).toBe(false);
  });

  it("uses a different key and its own consent for a different checkout", () => {
    const first = checkoutIdempotencyAttempt("/checkout?items=abc", false);
    const second = checkoutIdempotencyAttempt("/checkout?items=xyz", true);

    expect(second.key).not.toBe(first.key);
    expect(first.metaConsent).toBe(false);
    expect(second.metaConsent).toBe(true);
  });

  it("persists the key and consent atomically as one attempt", () => {
    const scope = "/checkout?items=abc";
    const attempt = checkoutIdempotencyAttempt(scope, true);
    expect(JSON.parse(sessionStorage.getItem(`luwag_checkout_idem:${scope}`)!)).toEqual(
      attempt,
    );
  });

  it("migrates a valid legacy raw key using the current consent once", () => {
    const scope = "/checkout?items=abc";
    const legacy = "legacy-key-123456789";
    window.sessionStorage.setItem(`luwag_checkout_idem:${scope}`, legacy);

    const migrated = checkoutIdempotencyAttempt(scope, true);
    const replay = checkoutIdempotencyAttempt(scope, false);

    expect(migrated).toEqual({ key: legacy, metaConsent: true });
    expect(replay).toEqual(migrated);
    expect(JSON.parse(sessionStorage.getItem(`luwag_checkout_idem:${scope}`)!)).toEqual(
      migrated,
    );
  });

  it("replaces a stored value the backend would reject", () => {
    window.sessionStorage.setItem("luwag_checkout_idem:/checkout?items=abc", "bad key");
    const attempt = checkoutIdempotencyAttempt("/checkout?items=abc", true);
    expect(attempt.key).not.toBe("bad key");
    expect(attempt.key).toMatch(SAFE);
    expect(attempt.metaConsent).toBe(true);
  });

  it("replaces a structured attempt with a key shorter than the backend minimum", () => {
    const short = "x".repeat(15);
    window.sessionStorage.setItem(
      "luwag_checkout_idem:/checkout?items=abc",
      JSON.stringify({ key: short, metaConsent: false }),
    );
    const attempt = checkoutIdempotencyAttempt("/checkout?items=abc", true);
    expect(attempt.key).not.toBe(short);
    expect(attempt.key).toMatch(SAFE);
    expect(attempt.metaConsent).toBe(true);
  });

  it("clears the completed scope so the next purchase gets a new attempt", () => {
    const scope = "/checkout?skuId=sku-1&qty=1&slug=chair";
    const first = checkoutIdempotencyAttempt(scope, false);
    clearCheckoutIdempotencyKey(scope);
    const second = checkoutIdempotencyAttempt(scope, true);
    expect(second.key).not.toBe(first.key);
    expect(second.key).toMatch(SAFE);
    expect(second.metaConsent).toBe(true);
  });

  it("clears only the scope that completed", () => {
    const completed = "/checkout?skuId=sku-1&qty=1&slug=chair";
    const other = "/checkout?skuId=sku-2&qty=1&slug=chair";
    const firstCompleted = checkoutIdempotencyAttempt(completed, false);
    const firstOther = checkoutIdempotencyAttempt(other, true);
    clearCheckoutIdempotencyKey(completed);
    expect(checkoutIdempotencyAttempt(completed, true).key).not.toBe(
      firstCompleted.key,
    );
    expect(checkoutIdempotencyAttempt(other, false)).toEqual(firstOther);
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

  it("still returns an attempt when sessionStorage is unavailable", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    try {
      expect(checkoutIdempotencyAttempt("/checkout?items=abc", true)).toEqual({
        key: expect.stringMatching(SAFE),
        metaConsent: true,
      });
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it("keeps the no-crypto fallback at the backend minimum length", () => {
    vi.stubGlobal("crypto", {});
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const attempt = checkoutIdempotencyAttempt("/checkout?items=abc", false);
      expect(attempt.key.length).toBeGreaterThanOrEqual(16);
      expect(attempt.key).toMatch(SAFE);
    } finally {
      random.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

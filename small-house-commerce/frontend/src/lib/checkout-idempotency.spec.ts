import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkoutIdempotencyKey } from "./checkout-idempotency";

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
});

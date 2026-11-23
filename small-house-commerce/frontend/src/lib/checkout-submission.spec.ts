import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginCheckoutSubmission,
  CHECKOUT_SUBMISSION_TTL_MS,
  clearCheckoutSubmission,
  markCheckoutSubmissionOrdered,
  readCheckoutSubmission,
} from "./checkout-submission";

const SCOPE = "/checkout?skuId=sku-1&qty=1&slug=chair";
const KEY = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

function input(overrides: Partial<Parameters<typeof beginCheckoutSubmission>[0]> = {}) {
  return {
    scope: SCOPE,
    idempotencyKey: KEY,
    metaConsent: false,
    attemptId: "attempt-1",
    startedAt: 1_000,
    payload: { customer: { phone: "0917" }, items: [{ skuId: "sku-1", quantity: 1 }] },
    ...overrides,
  };
}

beforeEach(() => {
  clearCheckoutSubmission(SCOPE);
  window.sessionStorage.clear();
});

describe("checkout submission", () => {
  it("persists the exact attempt before the request is sent", () => {
    const submission = beginCheckoutSubmission(input(), 1_000);
    expect(submission.status).toBe("SUBMITTED");
    expect(readCheckoutSubmission(SCOPE, 1_000)).toEqual(submission);
  });

  it("never replaces the key or payload of an unresolved attempt", () => {
    const first = beginCheckoutSubmission(input(), 1_000);
    const second = beginCheckoutSubmission(
      input({ idempotencyKey: "another-key-1234567890", payload: { items: [] } }),
      1_100,
    );
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.payload).toEqual(first.payload);
  });

  it("keeps the order number once the server confirmed the attempt", () => {
    beginCheckoutSubmission(input(), 1_000);
    markCheckoutSubmissionOrdered(SCOPE, "PH3001");
    expect(readCheckoutSubmission(SCOPE, 1_000)).toMatchObject({
      status: "ORDERED",
      orderNumber: "PH3001",
    });
  });

  it("expires an old attempt instead of replaying it much later", () => {
    beginCheckoutSubmission(input(), 1_000);
    expect(readCheckoutSubmission(SCOPE, 1_000 + CHECKOUT_SUBMISSION_TTL_MS + 1)).toBeNull();
  });

  it("ignores corrupt storage", () => {
    window.sessionStorage.setItem("luwag_checkout_submission:" + SCOPE, "not json");
    expect(readCheckoutSubmission(SCOPE, 1_000)).toBeNull();
  });

  it("clears the attempt so a later purchase starts fresh", () => {
    beginCheckoutSubmission(input(), 1_000);
    clearCheckoutSubmission(SCOPE);
    expect(readCheckoutSubmission(SCOPE, 1_000)).toBeNull();
  });

  it("still exposes the attempt to the current mount when storage is denied", () => {
    const denied = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    vi.stubGlobal("sessionStorage", denied);
    try {
      const created = beginCheckoutSubmission(input(), 1_000);
      expect(created.idempotencyKey).toBe(KEY);
      expect(readCheckoutSubmission(SCOPE, 1_000)?.idempotencyKey).toBe(KEY);
      expect(() => markCheckoutSubmissionOrdered(SCOPE, "PH3001")).not.toThrow();
      expect(() => clearCheckoutSubmission(SCOPE)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

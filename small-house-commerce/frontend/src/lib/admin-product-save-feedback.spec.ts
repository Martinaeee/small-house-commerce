import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeProductCreated, rememberProductCreated } from "./admin-product-save-feedback";

describe("product create feedback receipt", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("belongs to one product and can only be consumed once", () => {
    rememberProductCreated("p1");
    expect(consumeProductCreated("p2")).toBe(false);
    expect(consumeProductCreated("p1")).toBe(true);
    expect(consumeProductCreated("p1")).toBe(false);
  });

  it("does not replay stale receipts on later visits", () => {
    sessionStorage.setItem("admin:product-created:p1", String(Date.now() - 60_001));
    expect(consumeProductCreated("p1")).toBe(false);
  });

  it("does not report a failure when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage disabled"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage disabled"); });
    expect(() => rememberProductCreated("p1")).not.toThrow();
    expect(consumeProductCreated("p1")).toBe(false);
  });
});

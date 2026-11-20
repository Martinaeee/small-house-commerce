import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cardTestProduct } from "@/test/product-card-fixtures";
import { useCheckoutLines } from "./useCheckoutLines";

vi.mock("@/components/cart/CartContext", () => ({
  useCart: () => ({ cart: null, loading: false }),
}));

const PEGBOARD = cardTestProduct({
  slug: "pegboard",
  variants: [
    {
      id: "v-1",
      name: "2-Tier",
      position: 0,
      combinationKey: "tier:2",
      optionValueIds: ["t2"],
      sku: { id: "sku-1", skuCode: "T2", status: "ACTIVE", price: 2399, compareAtPrice: 2999, availableInventory: 4 },
    },
  ],
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useCheckoutLines Buy Now item loading", () => {
  it("gives up on a hung item request instead of showing Loading item forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const { result } = renderHook(() =>
      useCheckoutLines({ skuId: "sku-1", qty: "1", slug: "pegboard" }),
    );
    expect(result.current.productError).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_200);
    });
    expect(result.current.productError).toBe(true);
  });

  it("recovers through an explicit retry after a failed load", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      useCheckoutLines({ skuId: "sku-1", qty: "1", slug: "pegboard" }),
    );
    await act(async () => {});
    expect(result.current.productError).toBe(true);

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(PEGBOARD), { status: 200 }),
    );
    await act(async () => {
      result.current.retry();
    });
    expect(result.current.productError).toBe(false);
    expect(result.current.product?.slug).toBe("pegboard");
  });
});

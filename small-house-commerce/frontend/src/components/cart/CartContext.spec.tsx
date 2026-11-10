import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CartSummary } from "@/lib/api";

const apiMock = vi.hoisted(() => ({ getCart: vi.fn() }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { ...actual.api, getCart: apiMock.getCart } };
});

import { CartProvider, useCart } from "./CartContext";

function summary(items: number): CartSummary {
  return {
    cartId: "cart-1",
    expiresAt: "2026-11-10T00:00:00.000Z",
    items: Array.from({ length: items }, (_, index) => ({
      itemId: `item-${index}`,
      skuId: `sku-${index}`,
      skuCode: `SKU-${index}`,
      productName: "Chair",
      productSlug: "chair",
      variantName: "Red",
      quantity: 1,
      unitPrice: 100,
      compareAtPrice: null,
      lineTotal: 100,
      availableInventory: 5,
      unavailable: false,
      optionValues: [],
      thumbnail: null,
    })),
    subtotal: items * 100,
    discount: 0,
    shipping: 0,
    total: items * 100,
  };
}

function Probe() {
  const { cart, loading, error, reload } = useCart();
  return (
    <>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="count">{cart ? cart.items.length : "none"}</span>
      <span data-testid="error">{error ?? ""}</span>
      <button type="button" onClick={() => void reload()}>
        reload
      </button>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("cartId", "cart-1");
});

describe("CartProvider read failures", () => {
  it("keeps the last valid cart when a reload answers 502", async () => {
    apiMock.getCart.mockResolvedValueOnce(summary(2));
    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("2"));

    apiMock.getCart.mockRejectedValueOnce(
      Object.assign(new Error("Bad gateway"), { status: 502 }),
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "reload" }));

    await waitFor(() =>
      expect(screen.getByTestId("error")).not.toHaveTextContent(""),
    );
    // The 502 did not wipe the lines the shopper can still see and check out.
    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(localStorage.getItem("cartId")).toBe("cart-1");
  });

  it("clears the error after a successful retry", async () => {
    apiMock.getCart.mockResolvedValueOnce(summary(1));
    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));

    apiMock.getCart.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await userEvent.setup().click(screen.getByRole("button", { name: "reload" }));
    await waitFor(() =>
      expect(screen.getByTestId("error")).not.toHaveTextContent(""),
    );

    apiMock.getCart.mockResolvedValueOnce(summary(1));
    await userEvent.setup().click(screen.getByRole("button", { name: "reload" }));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent(""));
  });

  it("shows an error, not an empty cart, when the first read fails", async () => {
    apiMock.getCart.mockRejectedValueOnce(
      Object.assign(new Error("Service unavailable"), { status: 503 }),
    );
    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("count")).toHaveTextContent("none");
    expect(screen.getByTestId("error")).not.toHaveTextContent("");
    // The cart id is kept so a retry can still find the same cart.
    expect(localStorage.getItem("cartId")).toBe("cart-1");
  });

  it("stays quiet when there is no cart at all", async () => {
    localStorage.removeItem("cartId");
    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"));
    expect(screen.getByTestId("count")).toHaveTextContent("none");
    expect(screen.getByTestId("error")).toHaveTextContent("");
    expect(apiMock.getCart).not.toHaveBeenCalled();
  });
});

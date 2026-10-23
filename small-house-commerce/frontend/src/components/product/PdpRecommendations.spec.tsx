import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Product } from "@/lib/api";
import { PdpRecommendations } from "./PdpRecommendations";

const cartMock = vi.hoisted(() => ({
  current: { items: [] as { productSlug: string }[] },
}));
const hookMock = vi.hoisted(() => ({ items: [] as Product[] }));

vi.mock("@/components/cart/CartContext", () => ({
  useCart: () => ({ cart: cartMock.current }),
}));
vi.mock("@/lib/useCartRecommendations", () => ({
  useCartRecommendations: () => hookMock.items,
}));
vi.mock("./ProductCard", () => ({
  ProductCard: ({ product }: { product: Product }) => (
    <div data-testid="rec-card">{product.slug}</div>
  ),
}));

function product(id: string, slug: string): Product {
  return { id, slug, name: slug } as unknown as Product;
}

const current = product("p0", "current");

beforeEach(() => {
  cartMock.current = { items: [] };
  hookMock.items = [];
});

describe("PdpRecommendations", () => {
  it("fills the rail from the server list and skips the current product", () => {
    render(
      <PdpRecommendations
        currentProduct={current}
        fallback={[
          current,
          product("p1", "a"),
          product("p2", "b"),
          product("p3", "c"),
          product("p4", "d"),
          product("p5", "e"),
        ]}
      />,
    );

    const cards = screen.getAllByTestId("rec-card");
    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.textContent)).toEqual(["a", "b", "c", "d"]);

    const rail = document.querySelector("ul")!;
    expect(rail.className).toContain("overflow-x-auto");
    expect(rail.className).not.toContain("grid");
  });

  it("drops cart lines and replaces them with the cart recommender's picks", () => {
    cartMock.current = { items: [{ productSlug: "a" }] };
    hookMock.items = [product("p2", "b"), product("p3", "c"), product("p6", "f")];

    render(
      <PdpRecommendations
        currentProduct={current}
        fallback={[product("p1", "a"), product("p2", "b")]}
      />,
    );

    expect(
      screen.getAllByTestId("rec-card").map((card) => card.textContent),
    ).toEqual(["b", "c", "f"]);
  });
});

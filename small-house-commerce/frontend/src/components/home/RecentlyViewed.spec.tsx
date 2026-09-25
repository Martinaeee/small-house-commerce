import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Product } from "@/lib/api";
import { RecentlyViewed } from "./RecentlyViewed";

const fixtures = vi.hoisted(() => ({
  ids: [] as string[],
  getProductsByIds: vi.fn(),
}));

vi.mock("@/lib/recently-viewed", () => ({
  getRecentProductIds: () => [...fixtures.ids],
}));

vi.mock("@/lib/api", () => ({
  api: { getProductsByIds: fixtures.getProductsByIds },
}));

vi.mock("@/components/product/ProductCard", () => ({
  ProductCard: ({ product }: { product: Product }) => (
    <article data-testid="recent-card">{product.id}</article>
  ),
}));

function product(id: string): Product {
  return { id } as Product;
}

beforeEach(() => {
  fixtures.ids = [];
  fixtures.getProductsByIds.mockReset();
});

describe("RecentlyViewed", () => {
  it("excludes the current product before limiting and restores visit order", async () => {
    fixtures.ids = ["current", "a", "b", "c", "d", "e"];
    fixtures.getProductsByIds.mockResolvedValue({
      items: ["d", "b", "current", "a", "e", "c"].map(product),
    });

    render(<RecentlyViewed excludeProductId="current" limit={4} />);

    await waitFor(() =>
      expect(fixtures.getProductsByIds).toHaveBeenCalledWith([
        "a",
        "b",
        "c",
        "d",
      ]),
    );
    expect(
      (await screen.findAllByTestId("recent-card")).map(
        (card) => card.textContent,
      ),
    ).toEqual(["a", "b", "c", "d"]);
    expect(screen.queryByText("current")).not.toBeInTheDocument();
    expect(screen.queryByText("e")).not.toBeInTheDocument();
  });

  it("keeps the existing unfiltered behavior when no props are supplied", async () => {
    fixtures.ids = ["current", "a"];
    fixtures.getProductsByIds.mockResolvedValue({
      items: [product("a"), product("current")],
    });

    render(<RecentlyViewed />);

    await waitFor(() =>
      expect(fixtures.getProductsByIds).toHaveBeenCalledWith(["current", "a"]),
    );
    expect(
      (await screen.findAllByTestId("recent-card")).map(
        (card) => card.textContent,
      ),
    ).toEqual(["current", "a"]);
  });

  it("does not call the batch API when filtering leaves no IDs", () => {
    fixtures.ids = ["current"];

    render(<RecentlyViewed excludeProductId="current" limit={4} />);

    expect(fixtures.getProductsByIds).not.toHaveBeenCalled();
    expect(screen.queryByText("Recently Viewed")).not.toBeInTheDocument();
  });
});

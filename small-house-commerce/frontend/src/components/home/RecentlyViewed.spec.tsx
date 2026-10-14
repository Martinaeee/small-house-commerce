import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Product } from "@/lib/api";
import { CartProvider } from "@/components/cart/CartContext";
import { cardTestProduct } from "@/test/product-card-fixtures";
import { RecentlyViewed } from "./RecentlyViewed";

const fixtures = vi.hoisted(() => ({
  ids: [] as string[],
  getProductsByIds: vi.fn(),
}));

vi.mock("@/lib/recently-viewed", () => ({
  getRecentProductIds: () => [...fixtures.ids],
}));

vi.mock("@/lib/api", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: { ...original.api, getProductsByIds: fixtures.getProductsByIds } };
});

function product(id: string): Product {
  const cover = { id: `card:${id}:cover`, type: "IMAGE" as const, url: `/${id}-card.webp`, altText: `${id} card`, sortOrder: 0 };
  return cardTestProduct({ id, name: id, slug: id, cardMedia: {
    displayVariantId: "red-variant", unselected: { cover, scene: null },
    variants: [{ variantId: "red-variant", cover, scene: null }],
  } });
}

beforeEach(() => {
  localStorage.clear();
  fixtures.ids = [];
  fixtures.getProductsByIds.mockReset();
});

describe("RecentlyViewed", () => {
  it("excludes the current product before limiting and restores visit order", async () => {
    fixtures.ids = ["current", "a", "b", "c", "d", "e"];
    fixtures.getProductsByIds.mockResolvedValue({
      items: ["d", "b", "current", "a", "e", "c"].map(product),
    });

    render(<CartProvider><RecentlyViewed excludeProductId="current" limit={4} /></CartProvider>);

    await waitFor(() =>
      expect(fixtures.getProductsByIds).toHaveBeenCalledWith([
        "a",
        "b",
        "c",
        "d",
      ]),
    );
    expect(
      (await screen.findAllByRole("article")).map(
        (card) => card.getAttribute("data-product-id"),
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

    render(<CartProvider><RecentlyViewed /></CartProvider>);

    await waitFor(() =>
      expect(fixtures.getProductsByIds).toHaveBeenCalledWith(["current", "a"]),
    );
    expect(
      (await screen.findAllByRole("article")).map(
        (card) => card.getAttribute("data-product-id"),
      ),
    ).toEqual(["current", "a"]);
  });

  it("renders fresh independent images from the one batch response without borrowing the old gallery", async () => {
    fixtures.ids = ["a", "b"];
    const absent = product("b");
    delete absent.cardMedia;
    fixtures.getProductsByIds.mockResolvedValue({ items: [absent, product("a")] });
    const { container } = render(<CartProvider><RecentlyViewed /></CartProvider>);
    expect(await screen.findByRole("img", { name: "a card" })).toHaveAttribute("src", "/a-card.webp");
    expect(container.querySelector('article[data-product-id="b"] img')).toBeNull();
    expect(screen.queryByRole("img", { name: "Cover" })).not.toBeInTheDocument();
    expect(fixtures.getProductsByIds).toHaveBeenCalledTimes(1);
    expect(fixtures.getProductsByIds).toHaveBeenCalledWith(["a", "b"]);
    expect((await screen.findAllByRole("article")).map(card => card.getAttribute("data-product-id"))).toEqual(["a", "b"]);
  });

  it("does not call the batch API when filtering leaves no IDs", () => {
    fixtures.ids = ["current"];

    render(<CartProvider><RecentlyViewed excludeProductId="current" limit={4} /></CartProvider>);

    expect(fixtures.getProductsByIds).not.toHaveBeenCalled();
    expect(screen.queryByText("Recently Viewed")).not.toBeInTheDocument();
  });
});

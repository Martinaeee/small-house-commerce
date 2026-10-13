import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Product } from "@/lib/api";
import { ProductCard } from "./ProductCard";

vi.mock("@/components/back-in-stock/BackInStockTrigger", () => ({
  BackInStockTrigger: ({
    skuId,
    productName,
  }: {
    skuId: string;
    productName: string;
  }) => (
    <button type="button" data-testid="card-stock-alert" data-sku-id={skuId}>
      Notify {productName}
    </button>
  ),
}));

function productWithSkus(
  skus: Array<{
    id: string;
    status?: "ACTIVE" | "DISABLED";
    availableInventory: number;
  }>,
): Product {
  return {
    id: "product-1",
    name: "Luna Chair",
    slug: "luna-chair",
    description: null,
    tagline: null,
    categoryId: "category-1",
    ratingAverage: null,
    reviewCount: 0,
    room: null,
    internalRole: null,
    solutions: [],
    width: null,
    height: null,
    depth: null,
    foldedWidth: null,
    foldedHeight: null,
    foldedDepth: null,
    catalogGraphVersion: 1,
    options: [],
    defaultDisplayVariantId: skus[0] ? `variant-${skus[0].id}` : null,
    effectiveCoverMedia: null,
    images: [],
    variants: skus.map((sku, index) => ({
      id: `variant-${sku.id}`,
      name: `Variant ${index + 1}`,
      position: index,
      combinationKey: `variant-${index}`,
      optionValueIds: [],
      sku: {
        id: sku.id,
        skuCode: sku.id.toUpperCase(),
        status: sku.status ?? "ACTIVE",
        price: 100 + index,
        compareAtPrice: null,
        availableInventory: sku.availableInventory,
      },
    })),
  } as Product;
}

describe("ProductCard back-in-stock integration", () => {
  it("binds the trigger to the only resolved out-of-stock direct SKU", () => {
    render(
      <ProductCard
        product={productWithSkus([
          { id: "sku-direct-oos", availableInventory: 0 },
        ])}
      />,
    );

    expect(screen.getByTestId("card-stock-alert")).toHaveAttribute(
      "data-sku-id",
      "sku-direct-oos",
    );
  });

  it("keeps multi-SKU and unsellable cards on the PDP path", () => {
    const { rerender } = render(
      <ProductCard
        product={productWithSkus([
          { id: "sku-one", availableInventory: 0 },
          { id: "sku-two", availableInventory: 2 },
        ])}
      />,
    );

    expect(screen.queryByTestId("card-stock-alert")).toBeNull();

    rerender(
      <ProductCard
        product={productWithSkus([
          {
            id: "sku-disabled",
            status: "DISABLED",
            availableInventory: 0,
          },
        ])}
      />,
    );
    expect(screen.queryByTestId("card-stock-alert")).toBeNull();
    expect(screen.getByRole("link", { name: "View Details" })).toHaveAttribute(
      "href",
      "/products/luna-chair",
    );
  });
});

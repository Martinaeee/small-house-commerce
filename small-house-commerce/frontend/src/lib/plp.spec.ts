import { describe, expect, it } from "vitest";
import type { Product, StorefrontProductVariant } from "./api";
import {
  DEFAULT_FILTERS,
  filterProducts,
  isInStock,
  productCardPrice,
  sortProducts,
  type PlpFilters,
} from "./plp";

/**
 * Task 20 sweep: PLP price/stock derivation moves from the positional
 * `representativeSku` pick (first sellable SKU in API order) to the shared
 * selection contract. The first sellable SKU must never decide what a
 * visitor sees just because it happens to sit first.
 */

function sku(
  overrides: Partial<NonNullable<StorefrontProductVariant["sku"]>> = {},
): NonNullable<StorefrontProductVariant["sku"]> {
  return {
    id: "sku-default",
    skuCode: "CODE-1",
    status: "ACTIVE",
    price: 1000,
    compareAtPrice: null,
    availableInventory: 5,
    ...overrides,
  } as NonNullable<StorefrontProductVariant["sku"]>;
}

function variant(
  id: string,
  combinationKey: string,
  skuOverrides: Partial<NonNullable<StorefrontProductVariant["sku"]>> = {},
): StorefrontProductVariant {
  return {
    id,
    name: id,
    position: 0,
    combinationKey,
    optionValueIds: [],
    sku: sku(skuOverrides),
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Chair",
    slug: "chair",
    description: null,
    tagline: null,
    categoryId: "cat",
    status: "ACTIVE",
    room: null,
    internalRole: null,
    solutions: [],
    width: null,
    height: null,
    depth: null,
    foldedWidth: null,
    foldedHeight: null,
    foldedDepth: null,
    materials: null,
    features: null,
    catalogGraphVersion: 0,
    defaultDisplayVariantId: null,
    images: [],
    options: [],
    effectiveCoverMedia: null,
    variants: [variant("v1", "")],
    reviewCount: 0,
    ratingAverage: null,
    ...overrides,
  } as Product;
}

describe("productCardPrice", () => {
  it("shows the exact price of the single sellable SKU", () => {
    const result = productCardPrice(
      product({
        variants: [variant("v1", "", { price: 1299 })],
      }),
    );
    expect(result).toEqual({ kind: "exact", price: 1299, compareAtPrice: null });
  });

  it("shows the lowest sellable price as a from-floor when prices differ", () => {
    const result = productCardPrice(
      product({
        variants: [
          variant("v1", "k1", { price: 1299, id: "sku-1" }),
          variant("v2", "k2", { price: 899, id: "sku-2" }),
        ],
      }),
    );
    expect(result).toEqual({ kind: "from", price: 899, compareAtPrice: null });
  });

  it("ignores DISABLED or unpriced SKUs instead of positionally picking them", () => {
    const result = productCardPrice(
      product({
        variants: [
          // First in API order but not sellable: must not become the price.
          variant("v1", "", { status: "DISABLED", price: 1299, id: "sku-1" }),
          variant("v2", "", { price: 899, id: "sku-2" }),
        ],
      }),
    );
    expect(result).toEqual({ kind: "exact", price: 899, compareAtPrice: null });
  });

  it("returns null when nothing is sellable", () => {
    expect(
      productCardPrice(product({ variants: [variant("v1", "", { price: null })] })),
    ).toBeNull();
  });
});

describe("isInStock", () => {
  it("is true when any sellable SKU has stock, even if the first is out", () => {
    expect(
      isInStock(
        product({
          variants: [
            variant("v1", "k1", { availableInventory: 0, id: "sku-1" }),
            variant("v2", "k2", { availableInventory: 3, id: "sku-2" }),
          ],
        }),
      ),
    ).toBe(true);
  });

  it("is false when every sellable SKU is out of stock", () => {
    expect(
      isInStock(
        product({
          variants: [variant("v1", "", { availableInventory: 0 })],
        }),
      ),
    ).toBe(false);
  });

  it("is false when there is nothing sellable at all", () => {
    expect(
      isInStock(product({ variants: [variant("v1", "", { status: "DISABLED" })] })),
    ).toBe(false);
  });
});

describe("filterProducts price bands", () => {
  const inStockFilters: PlpFilters = {
    ...DEFAULT_FILTERS,
    priceBand: "1000-3000",
  };

  it("uses the contract price floor for band filtering", () => {
    const matched = filterProducts(
      [product({ variants: [variant("v1", "", { price: 899, id: "sku-1" })] })],
      inStockFilters,
    );
    expect(matched).toEqual([]);
  });

  it("keeps products whose floor price lands inside the band", () => {
    const matched = filterProducts(
      [product({ variants: [variant("v1", "", { price: 1500 })] })],
      inStockFilters,
    );
    expect(matched).toHaveLength(1);
  });
});

describe("sortProducts", () => {
  it("orders by the contract price floor, not by the first SKU's price", () => {
    const expensiveFirst = product({
      id: "p-expensive",
      slug: "expensive",
      variants: [variant("v1", "", { price: 2999, id: "sku-1" })],
    });
    const cheapFloor = product({
      id: "p-cheap",
      slug: "cheap",
      variants: [
        variant("v1", "k1", { price: 2999, id: "sku-a" }),
        variant("v2", "k2", { price: 999, id: "sku-b" }),
      ],
    });

    const sorted = sortProducts(
      [expensiveFirst, cheapFloor],
      "price-asc",
      new Set(),
    );
    expect(sorted[0].slug).toBe("cheap");
  });

  it("treats a product with an in-stock second SKU as in stock for fast dispatch", () => {
    const outOfStockFirst = product({
      id: "p-stocked",
      slug: "stocked",
      variants: [
        variant("v1", "", { availableInventory: 0, id: "sku-a" }),
        variant("v2", "", { availableInventory: 2, id: "sku-b" }),
      ],
    });
    const allOutOfStock = product({
      id: "p-empty",
      slug: "empty",
      variants: [variant("v1", "", { availableInventory: 0 })],
    });

    const sorted = sortProducts(
      [allOutOfStock, outOfStockFirst],
      "fast-dispatch",
      new Set(),
    );
    expect(sorted[0].slug).toBe("stocked");
  });
});

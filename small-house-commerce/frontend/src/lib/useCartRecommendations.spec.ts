import { describe, expect, it } from "vitest";
import type { Product, StorefrontProductVariant } from "@/lib/api";
import { directAddSku, quickAddEligible } from "@/lib/useCartRecommendations";

/**
 * Task 20 sweep: the recommendation pool and its quick-add button resolve
 * SKUs through the shared selection contract instead of the positional
 * `firstSku` pick (variants[0]). A multi-SKU product must never have "the
 * first SKU" added on the visitor's behalf — it opens the picker instead.
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

describe("directAddSku", () => {
  it("returns the SKU when exactly one sellable variant exists", () => {
    const target = sku({ id: "sku-only", price: 799 });
    expect(
      directAddSku(product({ variants: [variant("v1", "", { id: "sku-only", price: 799 })] })),
    ).toMatchObject({ id: target.id });
  });

  it("returns null for a multi-SKU product — the picker must decide", () => {
    expect(
      directAddSku(
        product({
          variants: [
            variant("v1", "k1", { id: "sku-a" }),
            variant("v2", "k2", { id: "sku-b" }),
          ],
        }),
      ),
    ).toBeNull();
  });

  it("ignores DISABLED or unpriced SKUs when counting sellable variants", () => {
    expect(
      directAddSku(
        product({
          variants: [
            variant("v1", "k1", { status: "DISABLED", id: "sku-a" }),
            variant("v2", "k2", { id: "sku-b" }),
          ],
        }),
      ),
    ).toMatchObject({ id: "sku-b" });
  });

  it("returns null when nothing is sellable", () => {
    expect(
      directAddSku(product({ variants: [variant("v1", "", { price: null })] })),
    ).toBeNull();
  });
});

describe("quickAddEligible", () => {
  it("accepts a multi-SKU product with at least one in-stock sellable SKU", () => {
    expect(
      quickAddEligible(
        product({
          variants: [
            variant("v1", "k1", { availableInventory: 0, id: "sku-a" }),
            variant("v2", "k2", { availableInventory: 4, id: "sku-b" }),
          ],
        }),
      ),
    ).toBe(true);
  });

  it("rejects a product whose sellable SKUs are all out of stock", () => {
    expect(
      quickAddEligible(
        product({ variants: [variant("v1", "", { availableInventory: 0 })] }),
      ),
    ).toBe(false);
  });

  it("rejects a product with no sellable SKU", () => {
    expect(
      quickAddEligible(
        product({ variants: [variant("v1", "", { status: "DISABLED" })] }),
      ),
    ).toBe(false);
  });
});

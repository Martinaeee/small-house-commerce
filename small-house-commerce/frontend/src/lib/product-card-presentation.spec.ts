import { describe, expect, it } from "vitest";
import type {
  Product,
  StorefrontProductOption,
  StorefrontProductVariant,
} from "./api";
import { cardPricePresentation } from "./product-card-presentation";
import {
  createInitialSelection,
  resolveSelection,
} from "./product-selection";

/**
 * Final review fix wave: pins the uniform-price branch of
 * cardPricePresentation (DESIGN §10.1) — an unresolved selection across a
 * multi-SKU product where every sellable SKU shares one price shows that
 * exact price, and the compare-at price only when the default display
 * variant actually sells at that same price.
 */

function option(
  id: string,
  values: { id: string; label: string }[],
): StorefrontProductOption {
  return {
    id,
    kind: id === "color" ? "COLOR" : "SIZE",
    name: id === "color" ? "Color" : "Size",
    position: id === "color" ? 0 : 1,
    presentation: "TEXT",
    isMediaDriver: false,
    values: values.map((value, index) => ({
      id: value.id,
      label: value.label,
      position: index,
      swatchHex: null,
      thumbnailUrl: null,
      thumbnailAlt: null,
    })),
  };
}

function variant(
  id: string,
  optionValueIds: string[],
  sku: StorefrontProductVariant["sku"],
): StorefrontProductVariant {
  return {
    id,
    name: id,
    position: 0,
    combinationKey: `color:${optionValueIds[0]}|size:${optionValueIds[1]}`,
    optionValueIds,
    sku,
  };
}

function productFixture(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod-1",
    name: "Rattan Stool",
    slug: "rattan-stool",
    description: null,
    tagline: null,
    categoryId: "cat-1",
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
    catalogGraphVersion: 2,
    options: [
      option("color", [{ id: "red", label: "Red" }, { id: "blue", label: "Blue" }]),
      option("size", [{ id: "small", label: "Small" }, { id: "large", label: "Large" }]),
    ],
    defaultDisplayVariantId: null,
    effectiveCoverMedia: null,
    images: [],
    variants: [],
    ...overrides,
  };
}

function derivedFor(product: Product) {
  // Two+ sellable SKUs keep the initial selection unresolved, which is the
  // precondition for the uniform-price branch.
  const derived = resolveSelection(product, createInitialSelection(product));
  expect(derived.resolvedVariant).toBeNull();
  return derived;
}

describe("cardPricePresentation uniform-price branch", () => {
  const redSmall = variant("variant-red-small", ["red", "small"], {
    id: "sku-red-small",
    skuCode: "RS",
    status: "ACTIVE",
    price: 100,
    compareAtPrice: 150,
    availableInventory: 4,
  });
  const redLarge = variant("variant-red-large", ["red", "large"], {
    id: "sku-red-large",
    skuCode: "RL",
    status: "ACTIVE",
    price: 100,
    compareAtPrice: null,
    availableInventory: 4,
  });

  it("shows the shared price with the display variant's compare-at price", () => {
    const product = productFixture({
      variants: [redSmall, redLarge],
      defaultDisplayVariantId: "variant-red-small",
    });

    expect(cardPricePresentation(derivedFor(product))).toEqual({
      kind: "exact",
      price: 100,
      compareAtPrice: 150,
    });
  });

  it("suppresses the compare-at price when the display variant does not sell at the shared price", () => {
    const product = productFixture({
      variants: [
        redSmall,
        redLarge,
        // Unpriced → not sellable → excluded from the shared-price set, but
        // still the default display variant; its compare-at must not leak.
        variant("variant-blue-small", ["blue", "small"], {
          id: "sku-blue-small",
          skuCode: "BS",
          status: "ACTIVE",
          price: null,
          compareAtPrice: 200,
          availableInventory: 0,
        }),
      ],
      defaultDisplayVariantId: "variant-blue-small",
    });

    expect(cardPricePresentation(derivedFor(product))).toEqual({
      kind: "exact",
      price: 100,
      compareAtPrice: null,
    });
  });
});

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type {
  Product,
  StorefrontProductOption,
  StorefrontProductVariant,
} from "@/lib/api";
import { ProductCard } from "./ProductCard";

/**
 * Storefront polish (2026-09-27): the shared ProductCard (homepage grid,
 * collections, related products) shows the rating row from existing product
 * data — stars + average + review count — only when the product actually has
 * reviews. DESIGN_SYSTEM §12 puts the rating between the name and the price.
 */

const cover = {
  id: "cover",
  url: "/cover.jpg",
  type: "IMAGE" as const,
  altText: "Cover",
  sortOrder: 0,
};

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    name: "Oak Side Table",
    slug: "oak-side-table",
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
    catalogGraphVersion: 7,
    options: [],
    defaultDisplayVariantId: null,
    effectiveCoverMedia: cover,
    images: [],
    variants: [],
    ...overrides,
  };
}

function styleOption(variantNames: string[]): StorefrontProductOption {
  return {
    id: "style-opt",
    kind: "STYLE",
    name: "Style",
    position: 0,
    presentation: "TEXT",
    isMediaDriver: false,
    values: variantNames.map((label, index) => ({
      id: `style-val-${index + 1}`,
      label,
      position: index,
      swatchHex: null,
      thumbnailUrl: null,
      thumbnailAlt: null,
    })),
  };
}

function singleVariant(skuOverrides: {
  price?: number | null;
  compareAtPrice?: number | null;
  availableInventory?: number;
  status?: "ACTIVE" | "DISABLED";
}): StorefrontProductVariant {
  return {
    id: "v-single",
    name: "Oak",
    position: 0,
    combinationKey: "style-opt:style-val-1",
    optionValueIds: ["style-val-1"],
    sku: {
      id: "sku-single",
      skuCode: "OAK-SINGLE",
      status: skuOverrides.status ?? "ACTIVE",
      price: skuOverrides.price ?? 100,
      compareAtPrice: skuOverrides.compareAtPrice ?? null,
      availableInventory: skuOverrides.availableInventory ?? 4,
    },
  };
}

const singleSkuProduct = buildProduct({
  options: [styleOption(["Oak"])],
  variants: [singleVariant({})],
  defaultDisplayVariantId: "v-single",
});

describe("ProductCard rating row", () => {
  it("renders stars, the average and the review count when the product has reviews", () => {
    render(
      <ProductCard
        product={buildProduct({
          ...singleSkuProduct,
          ratingAverage: 4.6,
          reviewCount: 128,
        })}
      />,
    );

    const row = screen.getByTestId("card-rating");
    expect(row).toBeVisible();
    expect(
      screen.getByRole("img", { name: "Rated 4.6 out of 5" }),
    ).toBeInTheDocument();
    expect(row).toHaveTextContent("4.6");
    expect(row).toHaveTextContent("(128)");
  });

  it("hides the rating row when the average is null even with reviews", () => {
    render(
      <ProductCard
        product={buildProduct({
          ...singleSkuProduct,
          ratingAverage: null,
          reviewCount: 12,
        })}
      />,
    );

    expect(screen.queryByTestId("card-rating")).toBeNull();
    expect(screen.queryByRole("img", { name: /^Rated / })).toBeNull();
  });

  it("hides the rating row when the review count is zero", () => {
    render(
      <ProductCard
        product={buildProduct({
          ...singleSkuProduct,
          ratingAverage: 4.6,
          reviewCount: 0,
        })}
      />,
    );

    expect(screen.queryByTestId("card-rating")).toBeNull();
    expect(screen.queryByRole("img", { name: /^Rated / })).toBeNull();
  });

  it("rounds a 4.5 average to four filled stars and one half star", () => {
    render(
      <ProductCard
        product={buildProduct({
          ...singleSkuProduct,
          ratingAverage: 4.5,
          reviewCount: 8,
        })}
      />,
    );

    const row = screen.getByRole("img", { name: "Rated 4.5 out of 5" });
    expect(
      Array.from(row.querySelectorAll("span")).map((glyph) => glyph.textContent),
    ).toEqual(["★", "★", "★", "★", "⯨"]);
  });
});

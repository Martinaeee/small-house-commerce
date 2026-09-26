import { describe, expect, expectTypeOf, it } from "vitest";
import type { Product } from "@/lib/api";
import { pdpDimensionSummary, pdpSolutionBadges } from "./pdp-facts";

type DimensionInput = Parameters<typeof pdpDimensionSummary>[0];

describe("pdpDimensionSummary", () => {
  it("formats complete assembled and folded product dimensions in W × H × D order", () => {
    expect(
      pdpDimensionSummary({
        width: 120,
        height: 74,
        depth: 60,
        foldedWidth: 120,
        foldedHeight: 8,
        foldedDepth: 60,
      }),
    ).toEqual({
      assembled: "120 × 74 × 60 cm",
      folded: "120 × 8 × 60 cm",
    });
  });

  it("preserves partial real dimensions and hides a dimension set with no values", () => {
    expect(
      pdpDimensionSummary({
        width: 120,
        height: null,
        depth: 60,
        foldedWidth: null,
        foldedHeight: null,
        foldedDepth: null,
      }),
    ).toEqual({
      assembled: "120 × — × 60 cm",
      folded: null,
    });
  });

  it("accepts only Product-level furniture dimension fields", () => {
    type HasPackageWidth = "packageWidth" extends keyof DimensionInput
      ? true
      : false;
    type HasProductWeight = "productWeight" extends keyof DimensionInput
      ? true
      : false;

    expectTypeOf<DimensionInput>().toMatchTypeOf<
      Pick<
        Product,
        | "width"
        | "height"
        | "depth"
        | "foldedWidth"
        | "foldedHeight"
        | "foldedDepth"
      >
    >();
    expectTypeOf<HasPackageWidth>().toEqualTypeOf<false>();
    expectTypeOf<HasProductWeight>().toEqualTypeOf<false>();
  });
});

describe("pdpSolutionBadges", () => {
  it("maps real solution tags to emoji selling points in canonical order", () => {
    expect(pdpSolutionBadges({ solutions: ["MOBILE", "FOLDABLE"] })).toEqual([
      { value: "FOLDABLE", emoji: "📦", label: "Foldable" },
      { value: "MOBILE", emoji: "🔄", label: "Easy to Move" },
    ]);
  });

  it("covers every solution the admin can tag", () => {
    expect(
      pdpSolutionBadges({
        solutions: [
          "FOLDABLE",
          "NARROW_SPACE",
          "MOBILE",
          "MULTIFUNCTIONAL",
          "HIDDEN_STORAGE",
          "RENTAL_FRIENDLY",
        ],
      }).map((badge) => badge.label),
    ).toEqual([
      "Foldable",
      "Narrow Space",
      "Easy to Move",
      "Multifunctional",
      "Hidden Storage",
      "Rental Friendly",
    ]);
  });

  it("returns nothing when the product carries no solution tags", () => {
    expect(pdpSolutionBadges({ solutions: [] })).toEqual([]);
  });
});

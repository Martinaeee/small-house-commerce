import { describe, expect, it } from "vitest";
import { pdpSolutionBadges, pdpSpecsVisible } from "./pdp-facts";

describe("pdpSolutionBadges", () => {
  it("maps real solution tags to selling points in canonical order", () => {
    expect(pdpSolutionBadges({ solutions: ["MOBILE", "FOLDABLE"] })).toEqual([
      { value: "FOLDABLE", label: "Foldable" },
      { value: "MOBILE", label: "Easy to Move" },
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

describe("pdpSpecsVisible", () => {
  const empty = {
    materials: null,
    width: null,
    height: null,
    depth: null,
    foldedWidth: null,
    foldedHeight: null,
    foldedDepth: null,
  };

  it("follows the displayed variant's weight, not the whole catalogue", () => {
    expect(pdpSpecsVisible(empty, null)).toBe(false);
    expect(pdpSpecsVisible(empty, 23)).toBe(true);
  });

  it("stays visible for product-level specs whatever the variant weighs", () => {
    expect(pdpSpecsVisible({ ...empty, materials: "Steel" }, null)).toBe(true);
    expect(pdpSpecsVisible({ ...empty, width: 88 }, null)).toBe(true);
    expect(pdpSpecsVisible({ ...empty, foldedDepth: 42 }, null)).toBe(true);
  });

  it("treats a blank materials string as absent", () => {
    expect(pdpSpecsVisible({ ...empty, materials: "   " }, null)).toBe(false);
  });
});

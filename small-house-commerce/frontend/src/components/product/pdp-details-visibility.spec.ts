import { describe, expect, it } from "vitest";
import type { Product } from "@/lib/api";
import { pdpHasDetails, pdpHasVisibleHighlights } from "./pdp-details-visibility";

type DetailSource = Pick<
  Product,
  "description" | "features" | "highlightsVisible" | "detailBlocks"
>;

function product(overrides: Partial<DetailSource> = {}): DetailSource {
  return {
    description: null,
    features: null,
    highlightsVisible: true,
    detailBlocks: [],
    ...overrides,
  };
}

describe("pdpHasDetails", () => {
  it("counts a description", () => {
    expect(pdpHasDetails(product({ description: "A compact table." }))).toBe(true);
  });

  it("counts visible feature bullets", () => {
    expect(pdpHasDetails(product({ features: "Folds flat" }))).toBe(true);
  });

  it("ignores bullets that are all hidden", () => {
    expect(pdpHasDetails(product({ features: "[hidden] Internal note" }))).toBe(false);
  });

  it("ignores bullets when the whole block is switched off", () => {
    expect(
      pdpHasDetails(product({ features: "Folds flat", highlightsVisible: false })),
    ).toBe(false);
  });

  it("counts detail media", () => {
    expect(
      pdpHasDetails(
        product({
          detailBlocks: [
            { id: "d1", type: "IMAGE", url: "/a.jpg", altText: null, sortOrder: 0 },
          ],
        }),
      ),
    ).toBe(true);
  });

  it("is false when there is nothing to show", () => {
    expect(pdpHasDetails(product())).toBe(false);
  });
});

describe("pdpHasVisibleHighlights", () => {
  it("is true only with a visible switch and at least one visible bullet", () => {
    expect(pdpHasVisibleHighlights(product({ features: "Folds flat" }))).toBe(true);
    expect(
      pdpHasVisibleHighlights(
        product({ features: "Folds flat", highlightsVisible: false }),
      ),
    ).toBe(false);
    expect(
      pdpHasVisibleHighlights(product({ features: "[hidden] Internal note" })),
    ).toBe(false);
  });
});

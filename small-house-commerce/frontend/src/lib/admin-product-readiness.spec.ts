import { describe, expect, it } from "vitest";
import {
  productReadiness,
  type ProductReadinessInput,
} from "./admin-product-readiness";
import type { AdminCatalogGraphDraft } from "./admin-product-graph";

function completeGraph(): AdminCatalogGraphDraft {
  return {
    catalogGraphVersion: 1,
    defaultDisplayVariantRef: { id: "variant-red" },
    options: [],
    variants: [
      {
        id: "variant-red",
        name: "Red",
        position: 0,
        combinationKey: "red",
        optionValueRefs: [],
        sku: {
          id: "sku-red",
          skuCode: "CHAIR-RED",
          status: "ACTIVE",
          supplierSku: null,
          supplierCost: null,
          costCurrency: null,
          landedCost: null,
          price: 0,
          compareAtPrice: null,
          productWeight: 0,
          packageWidth: 0,
          packageHeight: 0,
          packageDepth: 0,
          packageWeight: 0,
          volumetricWeight: 0,
          onHand: 0,
        },
      },
    ],
    media: [],
  };
}

function completeInput(
  overrides: Partial<ProductReadinessInput> = {},
): ProductReadinessInput {
  return {
    name: "Chair",
    slug: "chair",
    categoryId: "category-1",
    tagline: "Small-space comfort",
    description: "A compact chair.",
    images: [{ url: "https://example.com/chair.jpg" }],
    graph: completeGraph(),
    legacyVariants: [],
    ...overrides,
  };
}

describe("productReadiness", () => {
  it("treats zero-valued price and shipping measurements as filled values", () => {
    const readiness = productReadiness(completeInput());

    expect(readiness.complete).toBe(5);
    expect(readiness.total).toBe(5);
    expect(readiness.checks.every((check) => check.ok)).toBe(true);
    expect(readiness.warnings).toEqual([]);
  });

  it("warns for every active media-driver value that only falls back to shared media", () => {
    const graph = completeGraph();
    graph.options = [
      {
        id: "option-color",
        kind: "COLOR",
        name: "Color",
        position: 0,
        presentation: "SWATCH",
        isMediaDriver: true,
        isActive: true,
        values: [
          {
            id: "value-red",
            label: "Red",
            position: 0,
            swatchHex: "#ff0000",
            thumbnailUrl: null,
            thumbnailAlt: null,
            isActive: true,
          },
          {
            id: "value-disabled",
            label: "Old Blue",
            position: 1,
            swatchHex: null,
            thumbnailUrl: null,
            thumbnailAlt: null,
            isActive: false,
          },
        ],
      },
    ];
    graph.media = [
      {
        id: "variant-image",
        url: "https://example.com/exact.jpg",
        type: "IMAGE",
        altText: null,
        sortOrder: 0,
        optionValueRef: null,
        variantRef: { id: "variant-red" },
      },
    ];

    const readiness = productReadiness(
      completeInput({ tagline: "", description: "", graph }),
    );

    expect(readiness.warnings).toEqual([
      { key: "seo" },
      { key: "option_media", name: "Red" },
    ]);
  });

  it("counts option-value media only for the matching value scope", () => {
    const graph = completeGraph();
    graph.options = [
      {
        id: "option-color",
        kind: "COLOR",
        name: "Color",
        position: 0,
        presentation: "TEXT",
        isMediaDriver: true,
        isActive: true,
        values: [
          {
            id: "value-red",
            label: "Red",
            position: 0,
            swatchHex: null,
            thumbnailUrl: null,
            thumbnailAlt: null,
            isActive: true,
          },
        ],
      },
    ];
    graph.media = [
      {
        id: "red-image",
        url: "https://example.com/red.jpg",
        type: "IMAGE",
        altText: null,
        sortOrder: 0,
        optionValueRef: { id: "value-red" },
        variantRef: null,
      },
    ];

    expect(productReadiness(completeInput({ graph })).warnings).toEqual([]);
  });
});

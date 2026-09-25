import { describe, expect, it } from "vitest";
import {
  impactedSkuCount,
  summarizeAdminMedia,
  summarizeVariantMediaResolution,
} from "./admin-product-media-summary";
import type {
  AdminCatalogGraphDraft,
  AdminMediaDraft,
  AdminOptionDraft,
  AdminOptionValueDraft,
  AdminSkuDraft,
  AdminVariantDraft,
} from "./admin-product-graph";

function value(
  overrides: Partial<AdminOptionValueDraft> = {},
): AdminOptionValueDraft {
  return {
    id: "value-a",
    label: "Oak",
    position: 0,
    swatchHex: null,
    thumbnailUrl: null,
    thumbnailAlt: null,
    isActive: true,
    ...overrides,
  };
}

function option(overrides: Partial<AdminOptionDraft> = {}): AdminOptionDraft {
  return {
    id: "option-color",
    kind: "COLOR",
    name: "Finish",
    position: 0,
    presentation: "TEXT",
    isMediaDriver: true,
    isActive: true,
    values: [value()],
    ...overrides,
  };
}

function sku(id: string): AdminSkuDraft {
  return {
    id,
    skuCode: id.toUpperCase(),
    status: "ACTIVE",
    supplierSku: null,
    supplierCost: null,
    costCurrency: null,
    landedCost: null,
    price: 100,
    compareAtPrice: null,
    productWeight: null,
    packageWidth: null,
    packageHeight: null,
    packageDepth: null,
    packageWeight: null,
    volumetricWeight: null,
    onHand: 1,
  };
}

function variant(
  overrides: Partial<AdminVariantDraft> = {},
): AdminVariantDraft {
  return {
    id: "variant-a",
    name: "Oak",
    position: 0,
    combinationKey: "option-color:value-a",
    optionValueRefs: [{ id: "value-a" }],
    sku: sku("sku-a"),
    ...overrides,
  };
}

function media(overrides: Partial<AdminMediaDraft> = {}): AdminMediaDraft {
  return {
    id: "media-shared",
    url: "/shared.jpg",
    type: "IMAGE",
    altText: "Shared",
    sortOrder: 0,
    optionValueRef: null,
    variantRef: null,
    ...overrides,
  };
}

function graph(
  overrides: Partial<AdminCatalogGraphDraft> = {},
): AdminCatalogGraphDraft {
  return {
    catalogGraphVersion: 3,
    defaultDisplayVariantRef: null,
    options: [option()],
    variants: [variant()],
    media: [media()],
    ...overrides,
  };
}

function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("summarizeAdminMedia", () => {
  it("reports rows separately from usable URLs and counts real type and alt facts", () => {
    const rows = [
      {
        url: "hero.jpg",
        type: "IMAGE" as const,
        altText: "Hero",
        sortOrder: 8,
      },
      {
        url: "  ",
        type: "VIDEO" as const,
        altText: null,
        sortOrder: 0,
      },
      {
        url: "clip.mp4",
        type: "VIDEO" as const,
        altText: "   ",
        sortOrder: 2,
      },
    ];
    const before = snapshot(rows);

    expect(summarizeAdminMedia(rows)).toEqual({
      rowCount: 3,
      usableCount: 2,
      imageCount: 1,
      videoCount: 2,
      altCompleteCount: 1,
    });
    expect(rows).toEqual(before);
  });

  it("does not reorder unsorted input while deriving an empty summary", () => {
    const rows = [
      { url: "", type: "VIDEO" as const, altText: " ", sortOrder: 10 },
      { url: " ", type: "IMAGE" as const, altText: null, sortOrder: -1 },
    ];
    const before = snapshot(rows);

    expect(summarizeAdminMedia(rows)).toEqual({
      rowCount: 2,
      usableCount: 0,
      imageCount: 1,
      videoCount: 1,
      altCompleteCount: 0,
    });
    expect(rows).toEqual(before);
  });
});

describe("impactedSkuCount", () => {
  it("counts all SKU-bearing variants for Shared only without mutating the graph", () => {
    const draft = graph({
      variants: [
        variant({ id: "variant-a", sku: sku("sku-a") }),
        variant({ id: "variant-b", sku: sku("sku-b") }),
        variant({ id: "variant-no-sku", sku: null }),
      ],
    });
    const before = snapshot(draft);

    expect(impactedSkuCount(draft, null)).toBe(2);
    expect(draft).toEqual(before);
  });

  it("uses active value refs rather than duplicate labels and excludes variants without SKUs", () => {
    const driver = option({
      values: [
        value({ id: "value-active-a", label: "Same", isActive: true }),
        value({ clientKey: "value-active-b", id: undefined, label: "Same", isActive: true }),
        value({ id: "value-inactive", label: "Same", isActive: false }),
      ],
    });
    const draft = graph({
      options: [driver],
      variants: [
        variant({
          id: "variant-a",
          optionValueRefs: [{ id: "value-active-a" }],
          sku: sku("sku-a"),
        }),
        variant({
          id: "variant-b",
          optionValueRefs: [{ clientKey: "value-active-b" }],
          sku: sku("sku-b"),
        }),
        variant({
          id: "variant-inactive",
          optionValueRefs: [{ id: "value-inactive" }],
          sku: sku("sku-inactive"),
        }),
        variant({
          id: "variant-no-sku",
          optionValueRefs: [{ id: "value-active-a" }],
          sku: null,
        }),
      ],
    });
    const before = snapshot(draft);

    expect(impactedSkuCount(draft, driver)).toBe(2);
    expect(impactedSkuCount(draft, { ...driver, isActive: false })).toBe(0);
    expect(draft).toEqual(before);
  });
});

describe("summarizeVariantMediaResolution", () => {
  it("uses usable exact rows ahead of option-value and shared rows", () => {
    const selected = variant({ id: undefined, clientKey: "variant-new" });
    const draft = graph({
      variants: [selected],
      media: [
        media({ id: "shared-1" }),
        media({
          id: "value-1",
          url: "/value.jpg",
          optionValueRef: { id: "value-a" },
        }),
        media({
          id: "exact-blank",
          url: " ",
          variantRef: { clientKey: "variant-new" },
        }),
        media({
          id: "exact-1",
          url: "/exact-1.jpg",
          variantRef: { clientKey: "variant-new" },
        }),
        media({
          id: "exact-2",
          url: "/exact-2.jpg",
          variantRef: { clientKey: "variant-new" },
        }),
      ],
    });
    const before = snapshot(draft);

    expect(summarizeVariantMediaResolution(draft, selected)).toEqual({
      source: "EXACT",
      count: 2,
      optionValueRef: null,
    });
    expect(draft).toEqual(before);
  });

  it("falls through blank exact rows to the active driver value scope", () => {
    const selected = variant();
    const draft = graph({
      variants: [selected],
      media: [
        media({ id: "shared-1" }),
        media({
          id: "value-blank",
          url: " ",
          optionValueRef: { id: "value-a" },
        }),
        media({
          id: "value-usable",
          url: "/value.jpg",
          optionValueRef: { id: "value-a" },
        }),
        media({
          id: "exact-blank",
          url: "",
          variantRef: { id: "variant-a" },
        }),
      ],
    });

    expect(summarizeVariantMediaResolution(draft, selected)).toEqual({
      source: "OPTION_VALUE",
      count: 1,
      optionValueRef: { id: "value-a" },
    });
  });

  it("uses stable refs when value labels collide or change", () => {
    const driver = option({
      values: [
        value({ id: "value-a", label: "Duplicate" }),
        value({ id: undefined, clientKey: "value-b", label: "Renamed" }),
      ],
    });
    const selected = variant({
      optionValueRefs: [{ clientKey: "value-b" }],
    });
    const draft = graph({
      options: [driver],
      variants: [selected],
      media: [
        media({ id: "shared-1" }),
        media({
          id: "wrong-label-match",
          url: "/wrong.jpg",
          optionValueRef: { id: "value-a" },
        }),
        media({
          id: "right-ref",
          url: "/right.jpg",
          optionValueRef: { clientKey: "value-b" },
        }),
      ],
    });

    expect(summarizeVariantMediaResolution(draft, selected)).toEqual({
      source: "OPTION_VALUE",
      count: 1,
      optionValueRef: { clientKey: "value-b" },
    });
  });

  it.each([
    ["no driver", option({ isMediaDriver: false })],
    ["inactive driver", option({ isMediaDriver: true, isActive: false })],
    [
      "inactive selected value",
      option({ values: [value({ isActive: false })] }),
    ],
  ])("falls back to usable shared media with %s", (_label, driver) => {
    const selected = variant();
    const draft = graph({
      options: [driver],
      variants: [selected],
      media: [
        media({ id: "shared-blank", url: " " }),
        media({ id: "shared-usable", url: "/shared.jpg" }),
        media({
          id: "value-usable",
          url: "/value.jpg",
          optionValueRef: { id: "value-a" },
        }),
      ],
    });

    expect(summarizeVariantMediaResolution(draft, selected)).toEqual({
      source: "SHARED",
      count: 1,
      optionValueRef: null,
    });
  });

  it("falls back to shared when exact and driver-value rows are all blank", () => {
    const selected = variant();
    const draft = graph({
      variants: [selected],
      media: [
        media({ id: "shared-a", url: "/shared-a.jpg" }),
        media({ id: "shared-b", url: "/shared-b.jpg" }),
        media({
          id: "value-blank",
          url: " ",
          optionValueRef: { id: "value-a" },
        }),
        media({
          id: "exact-blank",
          url: "",
          variantRef: { id: "variant-a" },
        }),
      ],
    });

    expect(summarizeVariantMediaResolution(draft, selected)).toEqual({
      source: "SHARED",
      count: 2,
      optionValueRef: null,
    });
  });
});

import { describe, expect, it } from "vitest";
import type {
  AdminCatalogGraph,
  AdminGraphMedia,
  AdminGraphSku,
  AdminGraphVariant,
  AdminProduct,
} from "@/lib/admin-api";
import {
  buildCatalogGraphPatch,
  buildVariantCandidates,
  canonicalCombinationKey,
  collectStockBatch,
  deserializeAdminProduct,
  graphFromAdminProduct,
  resolveStockBatchWrites,
  stripUnsavableMedia,
  syncSharedMediaDraft,
  toWireCatalogGraphPatch,
  validateAdminCatalogGraph,
  type AdminCatalogGraphDraft,
} from "@/lib/admin-product-graph";

/**
 * Pure adapter cover for the bridge between the server's typed option graph
 * (CatalogGraphService snapshot shape) and the admin product form draft,
 * including the minimal changed-row patch sent on save.
 *
 * Identity rules mirror the backend (catalog-graph.ts + catalog-graph.dto.ts):
 *  - persisted rows keep their UUIDs; new rows carry request-local clientKeys;
 *  - combinationKey is the canonical set of optionId:valueId pairs, so display
 *    position never changes identity;
 *  - media scope sets REPLACE rather than merge;
 *  - variant names are derived server-side and must never travel in the patch.
 */

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "c0a5c1d7-0001-4a00-8000-0000000000c1";
const COLOR_OPTION_ID = "22222222-2222-4222-8222-222222222222";
const RED_VALUE_ID = "33333333-3333-4333-8333-333333333333";
const BLUE_VALUE_ID = "44444444-4444-4444-8444-444444444444";
const VARIANT_RED_ID = "55555555-5555-4555-8555-555555555555";
const VARIANT_BLUE_ID = "66666666-6666-4666-8666-666666666666";
const SKU_RED_ID = "77777777-7777-4777-8777-777777777777";
const SKU_BLUE_ID = "88888888-8888-4888-8888-888888888888";
const MEDIA_1_ID = "99999999-9999-4999-8999-999999999999";
const MEDIA_2_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** UUID pairs have no characters requiring encoding, so key = a:b as on server. */
function comboKey(optionId: string, valueId: string): string {
  return `${optionId}:${valueId}`;
}

function skuRow(id: string, code: string, price: string, onHand: number): AdminGraphSku {
  return {
    id,
    skuCode: code,
    status: "ACTIVE",
    supplierId: null,
    supplierSku: null,
    supplierCost: null,
    costCurrency: null,
    landedCost: null,
    price,
    compareAtPrice: null,
    productWeight: null,
    packageWidth: null,
    packageHeight: null,
    packageDepth: null,
    packageWeight: null,
    volumetricWeight: null,
    onHand,
    reserved: 0,
    availableInventory: onHand,
  };
}

function mediaRow(
  id: string,
  url: string,
  sortOrder: number,
  scope: { optionValueId?: string | null; variantId?: string | null } = {},
): AdminGraphMedia {
  return {
    id,
    url,
    type: "IMAGE",
    altText: null,
    sortOrder,
    optionValueId: scope.optionValueId ?? null,
    variantId: scope.variantId ?? null,
  };
}

function variantRow(
  id: string,
  valueId: string,
  position: number,
  sku: AdminGraphSku,
): AdminGraphVariant {
  return {
    id,
    name: position === 0 ? "Red" : "Blue",
    position,
    combinationKey: comboKey(COLOR_OPTION_ID, valueId),
    optionValues: [{ optionId: COLOR_OPTION_ID, optionValueId: valueId }],
    sku,
    hasReferences: false,
  };
}

/** The server graph snapshot payload (CatalogGraphService AdminProduct core). */
function serverGraph(overrides: Partial<AdminCatalogGraph> = {}): AdminCatalogGraph {
  const redSku = skuRow(SKU_RED_ID, "CHAIR-RED", "1299.00", 4);
  const blueSku = skuRow(SKU_BLUE_ID, "CHAIR-BLUE", "1499.00", 2);
  return {
    catalogGraphVersion: 3,
    defaultDisplayVariantId: VARIANT_RED_ID,
    options: [
      {
        id: COLOR_OPTION_ID,
        kind: "COLOR",
        name: "Color",
        position: 0,
        presentation: "SWATCH",
        isMediaDriver: true,
        isActive: true,
        values: [
          {
            id: RED_VALUE_ID,
            label: "Red",
            position: 0,
            swatchHex: "#b91c1c",
            thumbnailUrl: null,
            thumbnailAlt: null,
            isActive: true,
          },
          {
            id: BLUE_VALUE_ID,
            label: "Blue",
            position: 1,
            swatchHex: "#1d4ed8",
            thumbnailUrl: null,
            thumbnailAlt: null,
            isActive: true,
          },
        ],
      },
    ],
    variants: [
      variantRow(VARIANT_RED_ID, RED_VALUE_ID, 0, redSku),
      variantRow(VARIANT_BLUE_ID, BLUE_VALUE_ID, 1, blueSku),
    ],
    media: [
      mediaRow(MEDIA_1_ID, "/uploads/catalog/2026/red.jpg", 0),
      mediaRow(MEDIA_2_ID, "/uploads/catalog/2026/blue.jpg", 1),
    ],
    ...overrides,
  };
}

/** Wraps a graph snapshot as the admin product payload carrying the graph. */
function productFor(graph: AdminCatalogGraph): AdminProduct {
  return {
    id: PRODUCT_ID,
    name: "Chair",
    slug: "chair",
    description: null,
    tagline: null,
    categoryId: CATEGORY_ID,
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
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    detailBlocks: [],
    catalogGraphVersion: graph.catalogGraphVersion,
    defaultDisplayVariantId: graph.defaultDisplayVariantId,
    images: graph.media.filter(
      ({ optionValueId, variantId }) =>
        optionValueId === null && variantId === null,
    ),
    options: graph.options,
    variants: graph.variants,
    media: graph.media,
  };
}

function draftFor(graph: AdminCatalogGraph = serverGraph()): AdminCatalogGraphDraft {
  return structuredClone(deserializeAdminProduct(productFor(graph)));
}

describe("deserializeAdminProduct", () => {
  it("keeps stable server ids and never fabricates client keys for persisted rows", () => {
    const draft = draftFor();

    expect(draft.options[0].id).toBe(COLOR_OPTION_ID);
    expect(draft.options[0].clientKey).toBeUndefined();
    expect(draft.options[0].values.map(({ id }) => id)).toEqual([
      RED_VALUE_ID,
      BLUE_VALUE_ID,
    ]);
    expect(draft.variants.map(({ id }) => id)).toEqual([
      VARIANT_RED_ID,
      VARIANT_BLUE_ID,
    ]);
    expect(draft.variants.flatMap((v) => (v.sku?.id ? [v.sku.id] : []))).toEqual([
      SKU_RED_ID,
      SKU_BLUE_ID,
    ]);
    expect(draft.media.map(({ id }) => id)).toEqual([MEDIA_1_ID, MEDIA_2_ID]);
  });

  it("round-trips the graph version and default display variant", () => {
    const draft = draftFor();

    expect(draft.catalogGraphVersion).toBe(3);
    expect(draft.defaultDisplayVariantRef).toEqual({ id: VARIANT_RED_ID });
  });

  it("converts decimal-as-string prices to editable numbers", () => {
    const draft = draftFor();

    expect(draft.variants[0].sku?.price).toBe(1299);
    expect(draft.variants[1].sku?.price).toBe(1499);
  });

  it("projects an option-less legacy product to stable request-local client keys", () => {
    const product = productFor(serverGraph());
    delete product.options;
    delete product.media;

    const first = deserializeAdminProduct(product);
    const second = deserializeAdminProduct(product);

    expect(first.options[0].clientKey).toBe(`legacy-option-${PRODUCT_ID}`);
    expect(first.options[0].values.map(({ clientKey }) => clientKey)).toEqual([
      `legacy-value-${VARIANT_RED_ID}`,
      `legacy-value-${VARIANT_BLUE_ID}`,
    ]);
    expect(first.variants.map(({ id }) => id)).toEqual([
      VARIANT_RED_ID,
      VARIANT_BLUE_ID,
    ]);
    // Same payload must deserialize to identical keys (no per-call randomness).
    expect(second).toEqual(first);
  });
});

describe("buildVariantCandidates", () => {
  it("enumerates cartesian combinations in option display order and flags existing rows", () => {
    const candidates = buildVariantCandidates(draftFor());

    expect(candidates).toHaveLength(2);
    expect(candidates[0].combinationKey).toBe(
      comboKey(COLOR_OPTION_ID, RED_VALUE_ID),
    );
    expect(candidates[0].name).toBe("Red");
    expect(candidates[0].exists).toBe(true);
    expect(candidates[0].variantId).toBe(VARIANT_RED_ID);
    expect(candidates[1].exists).toBe(true);
    expect(candidates[1].variantId).toBe(VARIANT_BLUE_ID);
  });

  it("allows exactly one hundred candidates", () => {
    const draft = draftFor(serverGraph({ options: [], variants: [], media: [] }));
    draft.options = [
      {
        id: "a0000000-0000-4000-8000-00000000000a",
        kind: "COLOR",
        name: "A",
        position: 0,
        presentation: "TEXT",
        isMediaDriver: false,
        isActive: true,
        values: Array.from({ length: 10 }, (_, i) => ({
          id: `b0000000-0000-4000-8000-0000000000${i}a`,
          label: `a${i}`,
          position: i,
          swatchHex: null,
          thumbnailUrl: null,
          thumbnailAlt: null,
          isActive: true,
        })),
      },
      {
        id: "a0000000-0000-4000-8000-00000000000b",
        kind: "SIZE",
        name: "B",
        position: 1,
        presentation: "TEXT",
        isMediaDriver: false,
        isActive: true,
        values: Array.from({ length: 10 }, (_, i) => ({
          id: `b0000000-0000-4000-8000-0000000000${i}b`,
          label: `b${i}`,
          position: i,
          swatchHex: null,
          thumbnailUrl: null,
          thumbnailAlt: null,
          isActive: true,
        })),
      },
    ];

    const candidates = buildVariantCandidates(draft);

    expect(candidates).toHaveLength(100);
    expect(candidates[0].name).toBe("a0 / b0");
    expect(candidates[99].name).toBe("a9 / b9");
  });

  it("rejects more than one hundred candidates", () => {
    const draft = draftFor(serverGraph({ options: [], variants: [], media: [] }));
    const makeValues = (prefix: "a" | "b", count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `d0000000-0000-4000-${prefix}000-0000000000${i}${prefix}`,
        label: `${prefix}${i}`,
        position: i,
        swatchHex: null,
        thumbnailUrl: null,
        thumbnailAlt: null,
        isActive: true,
      }));
    draft.options = [
      {
        id: "a0000000-0000-4000-8000-00000000000a",
        kind: "COLOR",
        name: "A",
        position: 0,
        presentation: "TEXT",
        isMediaDriver: false,
        isActive: true,
        values: makeValues("a", 11),
      },
      {
        id: "a0000000-0000-4000-8000-00000000000b",
        kind: "SIZE",
        name: "B",
        position: 1,
        presentation: "TEXT",
        isMediaDriver: false,
        isActive: true,
        values: makeValues("b", 10),
      },
    ];

    // 11 x 10 = 110 > 100: any count above the cap fails (the brief's 101 case).
    expect(() => buildVariantCandidates(draft)).toThrow(/100/);
  });

  it("offers one empty combination when no option groups are active", () => {
    const draft = draftFor(serverGraph({ options: [], variants: [], media: [] }));

    const candidates = buildVariantCandidates(draft);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].combinationKey).toBe("");
    expect(candidates[0].name).toBe("Default");
    expect(candidates[0].exists).toBe(false);
    expect(candidates[0].pairs).toEqual([]);
  });
});

describe("buildCatalogGraphPatch", () => {
  it("does not emit variant upserts when only option display order changes", () => {
    const draft = draftFor();
    draft.options[0].position = 1;

    const patch = buildCatalogGraphPatch(serverGraph(), draft);

    expect(patch.variantUpserts).toEqual([]);
    expect(patch.optionUpserts).toHaveLength(1);
    expect(patch.optionUpserts[0].id).toBe(COLOR_OPTION_ID);
    expect(patch.optionUpserts[0].position).toBe(1);
    // The backend validates every option upsert as a self-contained option, so
    // an active option must carry an active value even when only scalars moved.
    expect(
      patch.optionUpserts[0].values.filter((value) => value.isActive),
    ).toHaveLength(2);
  });

  it("keeps the payload valid when only the gallery-driver flag changes", () => {
    const draft = draftFor();
    draft.options[0].isMediaDriver = false;

    const patch = buildCatalogGraphPatch(serverGraph(), draft);

    expect(patch.optionUpserts).toHaveLength(1);
    expect(patch.optionUpserts[0].isMediaDriver).toBe(false);
    expect(patch.optionUpserts[0].isActive).toBe(true);
    expect(
      patch.optionUpserts[0].values.some((value) => value.isActive),
    ).toBe(true);
  });

  it("renames a value through an option upsert without emitting variants", () => {
    const draft = draftFor();
    draft.options[0].values[0].label = "Crimson";

    const patch = buildCatalogGraphPatch(serverGraph(), draft);

    expect(patch.variantUpserts).toEqual([]);
    expect(patch.optionUpserts).toHaveLength(1);
    expect(patch.optionUpserts[0].values).toEqual([
      expect.objectContaining({ id: RED_VALUE_ID, label: "Crimson", position: 0 }),
    ]);
    // The variant name is re-derived server-side from the renamed value.
    expect(patch.retirements.optionValueIds).toEqual([]);
  });

  it("adds a new candidate variant, preserving its client key and never sending a name", () => {
    const draft = draftFor();
    draft.options[0].values.push({
      clientKey: "value-green",
      label: "Green",
      position: 2,
      swatchHex: null,
      thumbnailUrl: null,
      thumbnailAlt: null,
      isActive: true,
    });
    draft.variants.push({
      clientKey: "variant-green",
      name: "Green",
      position: 2,
      combinationKey: `${COLOR_OPTION_ID}:value-green`,
      optionValueRefs: [
        { id: COLOR_OPTION_ID },
        { clientKey: "value-green" },
      ],
      sku: {
        clientKey: "sku-green",
        skuCode: "CHAIR-GRN",
        status: "ACTIVE",
        supplierSku: null,
        supplierCost: null,
        costCurrency: null,
        landedCost: null,
        price: 1599,
        compareAtPrice: null,
        productWeight: null,
        packageWidth: null,
        packageHeight: null,
        packageDepth: null,
        packageWeight: null,
        volumetricWeight: null,
        onHand: 5,
      },
    });

    const candidates = buildVariantCandidates(draft);
    expect(candidates).toHaveLength(3);
    expect(candidates[2].combinationKey).toBe(`${COLOR_OPTION_ID}:value-green`);
    expect(candidates[2].exists).toBe(false);

    const patch = buildCatalogGraphPatch(serverGraph(), draft);

    expect(patch.optionUpserts[0].values).toEqual([
      expect.objectContaining({ clientKey: "value-green", label: "Green" }),
    ]);
    expect(patch.variantUpserts).toHaveLength(1);
    const upsert = patch.variantUpserts[0];
    expect(upsert.clientKey).toBe("variant-green");
    expect(upsert.position).toBe(2);
    expect(upsert.optionValueRefs).toEqual([
      { id: COLOR_OPTION_ID },
      { clientKey: "value-green" },
    ]);
    // Backend-derived names must never travel in the patch.
    expect("name" in upsert).toBe(false);
    // Stock is written via the inventory batch, not the graph sku payload.
    expect("onHand" in (upsert.sku ?? {})).toBe(false);
    expect(upsert.sku).toMatchObject({ skuCode: "CHAIR-GRN", price: 1599 });
  });

  it("emits retirements when options, values and media are removed", () => {
    const draft = draftFor();
    draft.options = [];
    draft.variants = [];
    draft.media = draft.media.filter(({ id }) => id !== MEDIA_2_ID);

    const patch = buildCatalogGraphPatch(serverGraph(), draft);

    expect(patch.optionUpserts).toEqual([]);
    expect(patch.variantUpserts).toEqual([]);
    expect(patch.mediaUpserts).toEqual([]);
    expect(patch.retirements.optionIds).toEqual([COLOR_OPTION_ID]);
    expect(patch.retirements.optionValueIds).toEqual(
      expect.arrayContaining([RED_VALUE_ID, BLUE_VALUE_ID]),
    );
    expect(patch.retirements.mediaIds).toEqual([MEDIA_2_ID]);
    // Variants for retired combinations are disabled (history) or deleted by
    // server-side reconciliation; the client never retires them directly.
    expect(patch.retirements.variantIds).toEqual([]);
  });

  it("emits media upserts when only the media scope changes", () => {
    const draft = draftFor();
    // Move the shared image onto the Red value: scope sets REPLACE, not merge.
    draft.media[0].optionValueRef = { id: RED_VALUE_ID };

    const patch = buildCatalogGraphPatch(serverGraph(), draft);

    expect(patch.optionUpserts).toEqual([]);
    expect(patch.variantUpserts).toEqual([]);
    expect(patch.retirements.mediaIds).toEqual([]);
    expect(patch.mediaUpserts).toEqual([
      expect.objectContaining({
        id: MEDIA_1_ID,
        optionValueRef: { id: RED_VALUE_ID },
        variantRef: null,
      }),
    ]);
  });

  it("leaves defaultDisplayVariant undefined when unchanged, sends a ref when set and null when cleared", () => {
    const unchanged = buildCatalogGraphPatch(serverGraph(), draftFor());
    expect(unchanged.defaultDisplayVariant).toBeUndefined();

    const setDraft = draftFor();
    setDraft.defaultDisplayVariantRef = { id: VARIANT_BLUE_ID };
    expect(buildCatalogGraphPatch(serverGraph(), setDraft).defaultDisplayVariant)
      .toEqual({ id: VARIANT_BLUE_ID });

    const clearDraft = draftFor();
    clearDraft.defaultDisplayVariantRef = null;
    expect(buildCatalogGraphPatch(serverGraph(), clearDraft).defaultDisplayVariant)
      .toBeNull();
  });

  it("emits no patch rows for an untouched draft", () => {
    const patch = buildCatalogGraphPatch(serverGraph(), draftFor());

    expect(patch.optionUpserts).toEqual([]);
    expect(patch.variantUpserts).toEqual([]);
    expect(patch.mediaUpserts).toEqual([]);
    expect(patch.retirements).toEqual({
      optionIds: [],
      optionValueIds: [],
      variantIds: [],
      mediaIds: [],
    });
    expect(patch.defaultDisplayVariant).toBeUndefined();
  });
});

describe("validateAdminCatalogGraph", () => {
  it("accepts a clean graph and reports the candidate count", () => {
    const result = validateAdminCatalogGraph(draftFor());

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.activeOptionCount).toBe(1);
    expect(result.candidateCount).toBe(2);
  });

  it("rejects a third active option group", () => {
    const draft = draftFor();
    draft.options.push(
      {
        clientKey: "option-size",
        kind: "SIZE",
        name: "Size",
        position: 1,
        presentation: "TEXT",
        isMediaDriver: false,
        isActive: true,
        values: [
          {
            clientKey: "value-small",
            label: "Small",
            position: 0,
            swatchHex: null,
            thumbnailUrl: null,
            thumbnailAlt: null,
            isActive: true,
          },
        ],
      },
      {
        clientKey: "option-material",
        kind: "MATERIAL",
        name: "Material",
        position: 2,
        presentation: "TEXT",
        isMediaDriver: false,
        isActive: true,
        values: [
          {
            clientKey: "value-oak",
            label: "Oak",
            position: 0,
            swatchHex: null,
            thumbnailUrl: null,
            thumbnailAlt: null,
            isActive: true,
          },
        ],
      },
    );

    const result = validateAdminCatalogGraph(draft);

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/two active option groups/);
  });

  it("rejects duplicate active value labels case-insensitively", () => {
    const draft = draftFor();
    draft.options[0].values[1].label = "red";

    const result = validateAdminCatalogGraph(draft);

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/duplicate active value label/i);
  });

  it("rejects graphs above the candidate cap", () => {
    const draft = draftFor(serverGraph({ options: [], variants: [], media: [] }));
    draft.options = [
      {
        id: "a0000000-0000-4000-8000-00000000000a",
        kind: "COLOR",
        name: "A",
        position: 0,
        presentation: "TEXT",
        isMediaDriver: false,
        isActive: true,
        values: Array.from({ length: 11 }, (_, i) => ({
          id: `e0000000-0000-4000-a000-0000000000${i}a`,
          label: `a${i}`,
          position: i,
          swatchHex: null,
          thumbnailUrl: null,
          thumbnailAlt: null,
          isActive: true,
        })),
      },
      {
        id: "a0000000-0000-4000-8000-00000000000b",
        kind: "SIZE",
        name: "B",
        position: 1,
        presentation: "TEXT",
        isMediaDriver: false,
        isActive: true,
        values: Array.from({ length: 10 }, (_, i) => ({
          id: `e0000000-0000-4000-b000-0000000000${i}b`,
          label: `b${i}`,
          position: i,
          swatchHex: null,
          thumbnailUrl: null,
          thumbnailAlt: null,
          isActive: true,
        })),
      },
    ];

    const result = validateAdminCatalogGraph(draft);

    expect(result.ok).toBe(false);
    expect(result.candidateCount).toBe(110);
    expect(result.errors.join(" ")).toMatch(/100/);
  });
});

describe("collectStockBatch", () => {
  it("returns nothing when stock figures are unchanged", () => {
    expect(collectStockBatch(draftFor(), draftFor())).toEqual([]);
  });

  it("maps changed stock to the persisted sku id", () => {
    const baseline = draftFor();
    const draft = draftFor();
    draft.variants[0].sku!.onHand = 9;

    expect(collectStockBatch(draft, baseline)).toEqual([
      { skuId: SKU_RED_ID, onHand: 9 },
    ]);
  });

  it("maps stock for a newly created sku via the variant client key", () => {
    const baseline = draftFor();
    const draft = draftFor();
    draft.options[0].values.push({
      clientKey: "value-green",
      label: "Green",
      position: 2,
      swatchHex: null,
      thumbnailUrl: null,
      thumbnailAlt: null,
      isActive: true,
    });
    draft.variants.push({
      clientKey: "variant-green",
      name: "Green",
      position: 2,
      combinationKey: `${COLOR_OPTION_ID}:value-green`,
      optionValueRefs: [{ clientKey: "value-green" }],
      sku: {
        clientKey: "sku-green",
        skuCode: "CHAIR-GRN",
        status: "ACTIVE",
        supplierSku: null,
        supplierCost: null,
        costCurrency: null,
        landedCost: null,
        price: 1599,
        compareAtPrice: null,
        productWeight: null,
        packageWidth: null,
        packageHeight: null,
        packageDepth: null,
        packageWeight: null,
        volumetricWeight: null,
        onHand: 5,
      },
    });

    expect(collectStockBatch(draft, baseline)).toEqual([
      { skuClientKey: "variant-green", onHand: 5 },
    ]);
  });
});

describe("canonicalCombinationKey", () => {
  it("is order-insensitive and percent-encodes pair delimiters", () => {
    const pairs = [
      { optionId: "size-opt", valueId: "large" },
      { optionId: "color:opt", valueId: "red|x" },
    ];
    expect(canonicalCombinationKey(pairs)).toBe(
      canonicalCombinationKey([...pairs].reverse()),
    );
    // Delimiters inside ids/values never merge pairs.
    expect(canonicalCombinationKey(pairs)).not.toContain("red|x");
    expect(canonicalCombinationKey(pairs)).toBe(
      canonicalCombinationKey([
        { optionId: "color:opt", valueId: "red|x" },
        { optionId: "size-opt", valueId: "large" },
      ]),
    );
  });

  it("yields the single empty key for the zero-group candidate", () => {
    expect(canonicalCombinationKey([])).toBe("");
  });
});

describe("toWireCatalogGraphPatch", () => {
  it("emits full option writes and flattens media scope refs to the zod field names", () => {
    const draft = draftFor();
    draft.options[0].values[0].label = "Crimson";
    draft.media[0].optionValueRef = { id: RED_VALUE_ID };

    const wire = toWireCatalogGraphPatch(
      buildCatalogGraphPatch(serverGraph(), draft),
      7,
    );

    expect(wire.catalogGraphVersion).toBe(7);
    const optionWrite = wire.catalogGraph.options[0]!;
    // Full option object per optionWriteSchema, not a bare entity ref.
    expect(optionWrite).toMatchObject({
      id: COLOR_OPTION_ID,
      kind: "COLOR",
      name: "Color",
      position: 0,
      presentation: "SWATCH",
      isMediaDriver: true,
      isActive: true,
    });
    expect(optionWrite.values).toEqual([
      expect.objectContaining({ id: RED_VALUE_ID, label: "Crimson", isActive: true }),
    ]);

    const mediaWrite = wire.catalogGraph.media[0]!;
    expect(mediaWrite.optionValueId).toBe(RED_VALUE_ID);
    expect(mediaWrite.optionValueClientKey).toBeUndefined();
    expect(mediaWrite.variantId).toBeUndefined();
  });

  it("uses clientKey fields for request-created rows", () => {
    const draft = draftFor();
    draft.options[0].values.push({
      clientKey: "value-green",
      label: "Green",
      position: 2,
      swatchHex: null,
      thumbnailUrl: null,
      thumbnailAlt: null,
      isActive: true,
    });

    const wire = toWireCatalogGraphPatch(
      buildCatalogGraphPatch(serverGraph(), draft),
      3,
    );

    const valueWrite = wire.catalogGraph.options[0]!.values[0]!;
    expect(valueWrite.clientKey).toBe("value-green");
    expect(valueWrite.id).toBeUndefined();
  });

  it("omits defaultDisplayVariant when unchanged and sends null when cleared", () => {
    const unchanged = toWireCatalogGraphPatch(
      buildCatalogGraphPatch(serverGraph(), draftFor()),
      3,
    );
    expect("defaultDisplayVariant" in unchanged.catalogGraph).toBe(false);

    const cleared = draftFor();
    cleared.defaultDisplayVariantRef = null;
    const wire = toWireCatalogGraphPatch(
      buildCatalogGraphPatch(serverGraph(), cleared),
      3,
    );
    expect(wire.catalogGraph.defaultDisplayVariant).toBeNull();
  });

  it("never emits sku for sku-less rows without disable intent", () => {
    const graph = serverGraph();
    graph.variants[0] = { ...graph.variants[0], sku: null };
    const draft = draftFor(graph);
    // Only the position changes; neither side ever had a SKU.
    draft.variants[0].position = 5;

    const patch = buildCatalogGraphPatch(graph, draft);
    const upsert = patch.variantUpserts[0]!;
    expect(upsert.id).toBe(VARIANT_RED_ID);
    expect(upsert.position).toBe(5);
    expect("sku" in upsert).toBe(false);

    const wire = toWireCatalogGraphPatch(patch, graph.catalogGraphVersion);
    expect("sku" in wire.catalogGraph.variants[0]!).toBe(false);
  });

  it("emits sku null only as explicit disable intent", () => {
    const graph = serverGraph();
    const draft = draftFor(graph);
    // SKU removed from a variant that has one server-side: disable it.
    draft.variants[0].sku = null;
    draft.variants[0].position = 5;

    const patch = buildCatalogGraphPatch(graph, draft);
    expect(patch.variantUpserts[0]!.sku).toBeNull();
    const wire = toWireCatalogGraphPatch(patch, graph.catalogGraphVersion);
    expect(wire.catalogGraph.variants[0]!.sku).toBeNull();
  });
});

describe("syncSharedMediaDraft", () => {
  function sharedForm(draft: AdminCatalogGraphDraft) {
    return draft.media
      .filter(
        (row) => row.optionValueRef === null && row.variantRef === null,
      )
      .map((row, index) => ({
        url: row.url,
        type: row.type,
        altText: row.altText ?? "",
        sortOrder: String(index),
      }));
  }

  it("leaves the draft byte-identical when the gallery already matches", () => {
    const draft = draftFor();
    const before = structuredClone(draft);

    syncSharedMediaDraft(draft, sharedForm(draft));

    expect(draft).toEqual(before);
  });

  it("overlays edits positionally, keeps persisted ids and mints client keys for net-new rows", () => {
    const draft = draftFor();
    const images = [
      ...sharedForm(draft).map((row) => ({ ...row })),
      { url: "/uploads/catalog/2026/new.jpg", type: "IMAGE" as const, altText: "", sortOrder: "2" },
    ];
    images[0]!.url = "/uploads/catalog/2026/edited.jpg";

    syncSharedMediaDraft(draft, images);

    expect(draft.media[0]).toMatchObject({
      id: MEDIA_1_ID,
      url: "/uploads/catalog/2026/edited.jpg",
      sortOrder: 0,
    });
    const added = draft.media[2]!;
    expect(added.id).toBeUndefined();
    expect(added.clientKey).toBeDefined();
    expect(added.url).toBe("/uploads/catalog/2026/new.jpg");
    expect(added.sortOrder).toBe(2);
    // Scoped rows are untouched.
    expect(draft.media).toHaveLength(3);
  });

  it("drops removed rows so the patch retires their server ids", () => {
    const draft = draftFor();
    syncSharedMediaDraft(draft, sharedForm(draft).slice(0, 1));

    expect(draft.media.map(({ id }) => id)).toEqual([MEDIA_1_ID]);
    const patch = buildCatalogGraphPatch(serverGraph(), draft);
    expect(patch.retirements.mediaIds).toEqual([MEDIA_2_ID]);
  });

  it("keeps scoped rows intact when the shared gallery is replaced with fewer rows", () => {
    const draft = draftFor();
    draft.media.splice(1, 0, {
      id: "value-scoped",
      url: "/uploads/catalog/2026/red-detail.jpg",
      type: "IMAGE",
      altText: null,
      sortOrder: 0,
      optionValueRef: { id: RED_VALUE_ID },
      variantRef: null,
    });
    draft.media.push({
      id: "variant-scoped",
      url: "/uploads/catalog/2026/red-variant.jpg",
      type: "IMAGE",
      altText: null,
      sortOrder: 0,
      optionValueRef: null,
      variantRef: { id: VARIANT_RED_ID },
    });

    syncSharedMediaDraft(draft, [
      {
        url: "/uploads/catalog/2026/shared-replacement.jpg",
        type: "IMAGE",
        altText: "Shared replacement",
        sortOrder: "0",
      },
    ]);

    expect(draft.media).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "value-scoped", optionValueRef: { id: RED_VALUE_ID } }),
        expect.objectContaining({ id: "variant-scoped", variantRef: { id: VARIANT_RED_ID } }),
      ]),
    );
    expect(
      draft.media.filter((row) => row.optionValueRef === null && row.variantRef === null),
    ).toHaveLength(1);
    expect(draft.media.find((row) => row.id === "value-scoped")?.url).toBe(
      "/uploads/catalog/2026/red-detail.jpg",
    );
  });
});

describe("graphFromAdminProduct", () => {
  it("yields a baseline that an untouched typed draft diffs to an empty patch", () => {
    const product = productFor(serverGraph());
    const patch = buildCatalogGraphPatch(
      graphFromAdminProduct(product),
      deserializeAdminProduct(product),
    );

    expect(patch.optionUpserts).toEqual([]);
    expect(patch.variantUpserts).toEqual([]);
    expect(patch.mediaUpserts).toEqual([]);
    expect(patch.retirements).toEqual({
      optionIds: [],
      optionValueIds: [],
      variantIds: [],
      mediaIds: [],
    });
    expect(patch.defaultDisplayVariant).toBeUndefined();
  });

  it("surfaces legacy client keys as ids so the same draft also diffs empty", () => {
    const product = productFor(serverGraph());
    delete product.options;
    delete product.media;

    const draft = deserializeAdminProduct(product);
    const patch = buildCatalogGraphPatch(graphFromAdminProduct(product), draft);

    expect(patch.optionUpserts).toEqual([]);
    expect(patch.variantUpserts).toEqual([]);
    expect(patch.mediaUpserts).toEqual([]);
    expect(graphFromAdminProduct(product).options[0]!.id).toBe(
      `legacy-option-${PRODUCT_ID}`,
    );
  });
});

// --- Task 11 two-phase save helpers -------------------------------------------

describe("resolveStockBatchWrites", () => {
  it("maps client-key writes to real SKU ids via the save response's SKU codes", () => {
    const product = productFor(serverGraph());
    const baseline = deserializeAdminProduct(product);
    const draft = structuredClone(baseline);
    // A browser-created candidate row: client key + SKU code, no ids.
    draft.variants.push({
      clientKey: "variant-new-1",
      name: "Green",
      position: 5,
      combinationKey: "green-combo",
      optionValueRefs: [],
      sku: {
        skuCode: "SH-GREEN",
        status: "ACTIVE",
        supplierSku: null,
        supplierCost: null,
        costCurrency: null,
        landedCost: null,
        price: 1599,
        compareAtPrice: null,
        productWeight: null,
        packageWidth: null,
        packageHeight: null,
        packageDepth: null,
        packageWeight: null,
        volumetricWeight: null,
        onHand: 7,
      },
    });

    const { ready, unresolved } = resolveStockBatchWrites(
      collectStockBatch(draft, baseline),
      draft,
      // The graph PATCH response: the created variant carries a REAL sku id.
      productFor(
        serverGraph({
          variants: [
            variantRow(VARIANT_RED_ID, RED_VALUE_ID, 0, skuRow(SKU_RED_ID, "CHAIR-RED", "1299.00", 4)),
            variantRow(VARIANT_BLUE_ID, BLUE_VALUE_ID, 1, skuRow(SKU_BLUE_ID, "CHAIR-BLUE", "1499.00", 2)),
            {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              name: "Green",
              position: 5,
              combinationKey: "green-combo",
              optionValues: [],
              sku: skuRow(
                "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                "SH-GREEN",
                "1599.00",
                0,
              ),
              hasReferences: false,
            },
          ],
        }),
      ),
    );

    expect(unresolved).toEqual([]);
    // The persisted rows' stock was untouched, so only the new row ships —
    // resolved to a REAL sku id by matching the save response's SKU code.
    expect(ready).toEqual([
      {
        skuId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        onHand: 7,
        label: "Green",
      },
    ]);
  });

  it("keeps untouched persisted rows out and reports unresolvable rows", () => {
    const product = productFor(serverGraph());
    const baseline = deserializeAdminProduct(product);
    const draft = structuredClone(baseline);
    draft.variants[0]!.sku!.onHand = 10; // persisted row, real id
    draft.variants.push({
      clientKey: "variant-ghost",
      name: "Ghost",
      position: 9,
      combinationKey: "ghost",
      optionValueRefs: [],
      sku: {
        skuCode: "",
        status: "ACTIVE",
        supplierSku: null,
        supplierCost: null,
        costCurrency: null,
        landedCost: null,
        price: null,
        compareAtPrice: null,
        productWeight: null,
        packageWidth: null,
        packageHeight: null,
        packageDepth: null,
        packageWeight: null,
        volumetricWeight: null,
        onHand: 3,
      },
    });

    const { ready, unresolved } = resolveStockBatchWrites(
      collectStockBatch(draft, baseline),
      draft,
      product,
    );

    expect(ready).toEqual([
      { skuId: SKU_RED_ID, onHand: 10, label: "Red" },
    ]);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].label).toBe("Ghost");
    expect(unresolved[0].error).toMatch(/resolve/i);
  });
});

describe("stripUnsavableMedia", () => {
  it("drops URL-less rows and client-key scopes that no longer resolve", () => {
    const draft = draftFor();
    draft.media.push(
      {
        clientKey: "media-blank",
        url: "   ",
        type: "IMAGE",
        altText: null,
        sortOrder: 9,
        optionValueRef: { id: RED_VALUE_ID },
        variantRef: null,
      },
      {
        clientKey: "media-dangling",
        url: "/uploads/x.jpg",
        type: "IMAGE",
        altText: null,
        sortOrder: 10,
        optionValueRef: null,
        variantRef: { clientKey: "variant-removed-elsewhere" },
      },
      {
        clientKey: "media-ok",
        url: "/uploads/ok.jpg",
        type: "IMAGE",
        altText: null,
        sortOrder: 11,
        optionValueRef: { id: RED_VALUE_ID },
        variantRef: null,
      },
    );

    stripUnsavableMedia(draft);

    expect(draft.media.map(({ id, clientKey }) => id ?? clientKey)).toEqual([
      MEDIA_1_ID,
      MEDIA_2_ID,
      "media-ok",
    ]);
  });
});

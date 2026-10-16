import { describe, expect, it } from "vitest";
import type {
  AdminCatalogGraph,
  AdminGraphMedia,
  AdminGraphSku,
  AdminGraphVariant,
  AdminProduct,
} from "@/lib/admin-api";
import {
  applyProductDimensionsToVariants,
  buildCatalogGraphPatch,
  buildSavedPreview,
  deserializeProduct,
  cardGraphFromLegacyForm,
  setVariantCardImage,
  buildVariantCandidates,
  canonicalCombinationKey,
  collectStockBatch,
  deserializeAdminProduct,
  graphFromAdminProduct,
  resolveStockBatchWrites,
  removeSupersededDefaultVariant,
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
    isBundle: false,
    bundleVersion: 0,
    supplierId: null,
    supplierSku: null,
    supplierCost: null,
    costCurrency: null,
    landedCost: null,
    price,
    compareAtPrice: null,
    productWidth: null, productDepth: null, productHeight: null, productWeight: null,
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
    productCode: "P-000001",
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

describe("Bundle SKU draft boundaries", () => {
  it("hydrates virtual identity and definition version from a typed graph", () => {
    const graph = serverGraph();
    Object.assign(graph.variants[0].sku!, { isBundle: true, bundleVersion: 4 });
    expect(draftFor(graph).variants[0].sku).toMatchObject({ isBundle: true, bundleVersion: 4 });
  });

  it("keeps virtual identity through the legacy graph bridge", () => {
    const graph = serverGraph();
    Object.assign(graph.variants[0].sku!, { isBundle: true, bundleVersion: 4 });
    const legacy = productFor(graph);
    delete legacy.options;
    delete legacy.media;
    expect(deserializeAdminProduct(legacy).variants[0].sku).toMatchObject({ isBundle: true, bundleVersion: 4 });
  });

  it("keeps virtual identity through the saved product form adapter", () => {
    const graph = serverGraph();
    Object.assign(graph.variants[0].sku!, { isBundle: true, bundleVersion: 4 });
    const product = productFor(graph);
    const form = deserializeProduct(product);
    expect(form.variants[0].sku).toMatchObject({ isBundle: true, bundleVersion: 4 });
    expect(graphFromAdminProduct(product).variants[0].sku).toMatchObject({ isBundle: true, bundleVersion: 4 });
  });

  it("sends a new virtual marker but not component drafts,definition versions or physical stock", () => {
    const graph = serverGraph();
    graph.variants[0].sku = null;
    const draft = draftFor(graph);
    draft.variants[0].sku = structuredClone(draftFor().variants[0].sku!);
    delete draft.variants[0].sku.id;
    Object.assign(draft.variants[0].sku, { isBundle: true, bundleVersion: 0, bundleDraft: { version: 0, components: [] }, bundleDefinition: { version: 0, components: [], availableInventory: 0 } });
    const payload = toWireCatalogGraphPatch(buildCatalogGraphPatch(graph, draft), graph.catalogGraphVersion);
    expect(payload).toHaveProperty("catalogGraph.variants.0.sku.isBundle", true);
    for (const field of ["bundleVersion", "bundleDraft", "bundleDefinition", "onHand", "reserved"]) expect(payload).not.toHaveProperty(`catalogGraph.variants.0.sku.${field}`);
  });

  it("sends a persisted inventory-mode change to the authoritative immutable-mode guard instead of silently dropping it", () => {
    const graph = serverGraph();
    const draft = draftFor(graph);
    draft.variants[0].sku!.isBundle = true;
    const payload = toWireCatalogGraphPatch(buildCatalogGraphPatch(graph, draft), graph.catalogGraphVersion);
    expect(payload).toHaveProperty("catalogGraph.variants.0.sku.isBundle", true);
  });

  it("skips physical stock writes for persisted virtual SKUs while preserving ordinary writes", () => {
    const baseline = draftFor();
    const draft = draftFor();
    Object.assign(draft.variants[0].sku!, { isBundle: true, onHand: 999 });
    draft.variants[1].sku!.onHand = 9;
    expect(collectStockBatch(draft, baseline)).toEqual([{ skuId: SKU_BLUE_ID, onHand: 9 }]);
  });

  it("never schedules a zero-stock inventory row for an unpersisted virtual SKU", () => {
    const baseline = draftFor();
    const draft = draftFor();
    delete draft.variants[0].id;
    draft.variants[0].clientKey = "new-bundle";
    delete draft.variants[0].sku!.id;
    Object.assign(draft.variants[0].sku!, { isBundle: true, onHand: 0 });
    expect(collectStockBatch(draft, baseline)).toEqual([]);
  });
});

describe("materialized SKU product dimension bulk actions", () => {
  const dimensions = { width: 120, depth: 60, height: 75 };
  const overrides = { productWidth: 120, productDepth: 60, productHeight: 75 };

  it("fills an empty STYLE group while skipping a fully overridden STYLE group", () => {
    const draft = draftFor();
    draft.options[0].kind = "STYLE";
    Object.assign(draft.variants[1].sku!, overrides);
    const unchanged = structuredClone(draft.variants[1]);
    expect(applyProductDimensionsToVariants(draft, dimensions, "empty-only"))
      .toEqual({ changedCount: 1, skippedCount: 1 });
    expect(draft.variants[0].sku).toMatchObject(overrides);
    expect(draft.variants[1]).toEqual(unchanged);
  });

  it("replaces only dimension fields while preserving client keys, packages, prices and stock", () => {
    const draft = draftFor();
    delete draft.variants[0].id;
    draft.variants[0].clientKey = "draft-red";
    delete draft.variants[0].sku!.id;
    draft.variants[0].sku!.clientKey = "draft-red-sku";
    Object.assign(draft.variants[0].sku!, {
      productWidth: 99, productDepth: 88, productHeight: 77,
      packageWidth: 130, packageDepth: 70, packageHeight: 85,
      packageWeight: 5, volumetricWeight: 9,
    });
    const before = structuredClone(draft);
    const oldSku = draft.variants[0].sku;
    expect(applyProductDimensionsToVariants(draft, dimensions, "all"))
      .toEqual({ changedCount: 2, skippedCount: 0 });
    expect(draft).toEqual({
      ...before,
      variants: before.variants.map(row => ({ ...row, sku: { ...row.sku!, ...overrides } })),
    });
    expect(oldSku).toEqual(before.variants[0].sku);
    expect(draft.variants[0].sku).not.toBe(oldSku);
  });

  it("fills null axes within independent STYLE groups and never treats zero as empty", () => {
    const draft = draftFor();
    draft.options[0].kind = "STYLE";
    Object.assign(draft.variants[0].sku!, { productWidth: 0, productDepth: null, productHeight: 80 });
    Object.assign(draft.variants[1].sku!, overrides);
    expect(applyProductDimensionsToVariants(draft, dimensions, "empty-only"))
      .toEqual({ changedCount: 1, skippedCount: 1 });
    expect(draft.variants[0].sku).toMatchObject({ productWidth: 0, productDepth: 60, productHeight: 80 });
  });

  it("clears overrides to null rather than storing parent values", () => {
    const draft = draftFor();
    Object.assign(draft.variants[0].sku!, overrides);
    expect(applyProductDimensionsToVariants(draft, { width: null, depth: null, height: null }, "all"))
      .toEqual({ changedCount: 1, skippedCount: 1 });
    expect(draft.variants[0].sku).toMatchObject({ productWidth: null, productDepth: null, productHeight: null });
  });

  it("counts unchanged eligible rows as skipped and retains their SKU references", () => {
    const draft = draftFor();
    draft.variants.forEach(row => Object.assign(row.sku!, overrides));
    const skus = draft.variants.map(row => row.sku);
    expect(applyProductDimensionsToVariants(draft, dimensions, "all"))
      .toEqual({ changedCount: 0, skippedCount: 2 });
    draft.variants.forEach((row, index) => expect(row.sku).toBe(skus[index]));
  });

  it("does not materialize SKU-less rows or absent option combinations", () => {
    const draft = draftFor();
    draft.variants[1].sku = null;
    draft.options[0].values.push({
      ...draft.options[0].values[0], id: undefined, clientKey: "green", label: "Green", position: 2,
    });
    const before = structuredClone(draft);
    expect(applyProductDimensionsToVariants(draft, dimensions, "all"))
      .toEqual({ changedCount: 1, skippedCount: 0 });
    expect(draft.variants).toHaveLength(2);
    expect(draft.variants[1]).toEqual(before.variants[1]);
    expect(draft.options).toEqual(before.options);
  });

  it("excludes disabled SKUs from writes and result counts", () => {
    const draft = draftFor();
    draft.variants[1].sku!.status = "DISABLED";
    const before = structuredClone(draft.variants[1]);
    expect(applyProductDimensionsToVariants(draft, dimensions, "all"))
      .toEqual({ changedCount: 1, skippedCount: 0 });
    expect(draft.variants[1]).toEqual(before);
  });

  it("excludes combinations whose option value is inactive", () => {
    const draft = draftFor();
    draft.options[0].values[1].isActive = false;
    const before = structuredClone(draft.variants[1]);
    expect(applyProductDimensionsToVariants(draft, dimensions, "all"))
      .toEqual({ changedCount: 1, skippedCount: 0 });
    expect(draft.variants[1]).toEqual(before);
  });

  it.each(["draft", "persisted"])("keeps a superseded %s Default outside dimension bulk edits", kind => {
    const draft = draftFor();
    const leftover = structuredClone(draft.variants[0]);
    leftover.name = "Default";
    leftover.combinationKey = "";
    leftover.optionValueRefs = [];
    if (kind === "draft") {
      delete leftover.id;
      delete leftover.sku!.id;
      leftover.clientKey = "variant-";
    }
    draft.variants.push(leftover);
    const before = structuredClone(leftover);
    expect(applyProductDimensionsToVariants(draft, dimensions, "all"))
      .toEqual({ changedCount: 2, skippedCount: 0 });
    expect(draft.variants[2]).toEqual(before);
  });
});

describe("SKU product dimension codecs", () => {
  const dimensions = { productWidth: 120, productDepth: 60, productHeight: 75 };
  const packaging = { packageWidth: 130, packageDepth: 70, packageHeight: 85, packageWeight: 5, volumetricWeight: 9 };
  function configured() {
    const graph = serverGraph();
    Object.assign(graph.variants[0]!.sku!, dimensions, packaging);
    Object.assign(graph.variants[1]!.sku!, { productWidth: null, productDepth: null, productHeight: null });
    return graph;
  }

  it("hydrates raw overrides and inherited nulls in the typed graph", () => {
    const graph = configured();
    const draft = draftFor(graph);
    expect(draft.variants[0]!.sku).toMatchObject({ ...dimensions, ...packaging, id: SKU_RED_ID, price: 1299, onHand: 4 });
    expect(draft.variants[1]!.sku).toMatchObject({ productWidth: null, productDepth: null, productHeight: null });
    expect(graph.variants[0]!.sku).toMatchObject({ ...dimensions, price: "1299.00" });
  });

  it("preserves dimensions through legacy graph projection and baseline hydration", () => {
    const product = productFor(configured());
    delete product.options;
    delete product.media;
    const draft = deserializeAdminProduct(product);
    expect(draft.variants[0]!.sku).toMatchObject({ ...dimensions, ...packaging, id: SKU_RED_ID });
    expect(graphFromAdminProduct(product).variants[0]!.sku).toMatchObject(dimensions);
  });

  it("hydrates legacy form strings without mixing product and package axes", () => {
    const form = deserializeProduct(productFor(configured()));
    expect(form.variants[0]!.sku).toMatchObject({ productWidth: "120", productDepth: "60", productHeight: "75", packageWidth: "130", packageDepth: "70", packageHeight: "85" });
    expect(form.variants[1]!.sku).toMatchObject({ productWidth: "", productDepth: "", productHeight: "" });
  });

  it("keeps raw overrides in the diff baseline without creating a dirty patch", () => {
    const product = productFor(configured());
    const baseline = graphFromAdminProduct(product);
    expect(baseline.variants[0]!.sku).toMatchObject(dimensions);
    expect(buildCatalogGraphPatch(baseline, deserializeAdminProduct(product)).variantUpserts).toEqual([]);
  });

  it.each(Object.keys(dimensions) as (keyof typeof dimensions)[])("emits a dimension-only %s change with stable identities", field => {
    const graph = configured();
    const draft = draftFor(graph);
    Object.assign(draft.variants[0]!.sku!, dimensions, { [field]: 180 });
    const wire = toWireCatalogGraphPatch(buildCatalogGraphPatch(graph, draft), graph.catalogGraphVersion);
    expect(wire.catalogGraph.variants).toHaveLength(1);
    expect(wire.catalogGraph.variants[0]).toMatchObject({ id: VARIANT_RED_ID, sku: { ...dimensions, [field]: 180, ...packaging, skuCode: "CHAIR-RED", price: 1299 } });
    expect(Object.hasOwn(wire.catalogGraph.variants[0]!.sku!, "onHand")).toBe(false);
    expect(draft.variants[0]!.sku).toMatchObject({ id: SKU_RED_ID, onHand: 4 });
    expect(draft.variants[1]!.id).toBe(VARIANT_BLUE_ID);
  });

  it.each(Object.keys(dimensions) as (keyof typeof dimensions)[])("clears %s to null rather than copying the parent", field => {
    const graph = configured();
    const product = productFor(graph);
    product.width = 900;
    product.depth = 800;
    product.height = 700;
    const draft = deserializeAdminProduct(product);
    Object.assign(draft.variants[0]!.sku!, dimensions, { [field]: null });
    const wire = toWireCatalogGraphPatch(buildCatalogGraphPatch(graph, draft), graph.catalogGraphVersion);
    expect(wire.catalogGraph.variants).toHaveLength(1);
    expect(wire.catalogGraph.variants[0]!.sku).toMatchObject({ ...dimensions, [field]: null, ...packaging });
  });

  it("round-trips zero as a real override", () => {
    const graph = configured();
    const draft = draftFor(graph);
    Object.assign(draft.variants[0]!.sku!, { productWidth: 0, productDepth: 0, productHeight: 0 });
    const wire = toWireCatalogGraphPatch(buildCatalogGraphPatch(graph, draft), graph.catalogGraphVersion);
    expect(wire.catalogGraph.variants).toHaveLength(1);
    expect(wire.catalogGraph.variants[0]!.sku).toMatchObject({ productWidth: 0, productDepth: 0, productHeight: 0 });
  });

  it("converts only confirmed legacy form fields and preserves package values", () => {
    const form = deserializeProduct(productFor(configured()));
    Object.assign(form.variants[0]!.sku!, { productWidth: "125", productDepth: "", productHeight: "76" });
    const draft = cardGraphFromLegacyForm(form);
    expect(draft.variants[0]!.sku).toMatchObject({ productWidth: 125, productDepth: null, productHeight: 76, ...packaging, id: SKU_RED_ID, onHand: 4 });
  });
});

describe("independent variant card codecs", () => {
  const pair = () => ({
    cover: { type: "IMAGE" as const, url: "/uploads/red-card.webp", altText: "Red cover" },
    hover: { type: "IMAGE" as const, url: "/uploads/red-hover.webp", altText: null },
  });
  function configured() {
    const graph = serverGraph();
    Object.assign(graph.variants[0]!, { cardMedia: pair() });
    return graph;
  }

  it("hydrates independent copies in graph, legacy form, baseline and saved preview", () => {
    const product = productFor(configured());
    const graph = deserializeAdminProduct(product);
    const form = deserializeProduct(product);
    expect(graph.variants[0]).toHaveProperty("cardMedia", pair());
    expect(form.variants[0]).toHaveProperty("id", VARIANT_RED_ID);
    expect(form.variants[0]).toHaveProperty("cardMedia", pair());
    expect(graphFromAdminProduct(product).variants[0]).toHaveProperty("cardMedia", pair());
    expect(buildSavedPreview(product).variants[0]).toHaveProperty("cardMedia", pair());
    graph.variants[0]!.cardMedia!.cover!.url = "/changed.webp";
    expect(form.variants[0]).toHaveProperty("cardMedia.cover.url", "/uploads/red-card.webp");
    expect(product.variants[0]).toHaveProperty("cardMedia.cover.url", "/uploads/red-card.webp");
  });

  it("emits a card-only change without touching SKU identity or the PDP gallery", () => {
    const original = serverGraph();
    const draft = draftFor(original);
    draft.variants[0]!.cardMedia = pair();
    const patch = buildCatalogGraphPatch(original, draft);
    const wire = toWireCatalogGraphPatch(patch, original.catalogGraphVersion);
    expect(wire.catalogGraph.variants).toEqual([{
      id: VARIANT_RED_ID, position: 0, optionValueRefs: [{ id: RED_VALUE_ID }], cardMedia: pair(),
    }]);
    expect(patch.mediaUpserts).toEqual([]);
    expect(patch.retirements.variantIds).toEqual([]);
    expect(draft.variants[0]!.sku?.id).toBe(SKU_RED_ID);
  });

  it("does not resend card snapshots for a SKU-only edit", () => {
    const original = configured();
    const draft = draftFor(original);
    draft.variants[0]!.sku!.price = 1800;
    const wire = toWireCatalogGraphPatch(buildCatalogGraphPatch(original, draft), original.catalogGraphVersion);
    expect(wire.catalogGraph.variants[0]).not.toHaveProperty("cardMedia");
    expect(wire.catalogGraph.variants[0]!.sku).toMatchObject({ skuCode: "CHAIR-RED", price: 1800 });
    expect(draft.variants[0]).toHaveProperty("cardMedia", pair());
  });

  it.each([
    ["whole configuration", null],
    ["cover slot", { cover: null, hover: pair().hover }],
    ["hover slot", { cover: pair().cover, hover: null }],
  ] as const)("preserves explicit clearing of %s in the wire", (_label, cardMedia) => {
    const original = configured();
    const draft = draftFor(original);
    draft.variants[0]!.cardMedia = cardMedia;
    const wire = toWireCatalogGraphPatch(buildCatalogGraphPatch(original, draft), original.catalogGraphVersion);
    expect(wire.catalogGraph.variants).toHaveLength(1);
    expect(wire.catalogGraph.variants[0]).toHaveProperty("cardMedia", cardMedia);
    expect(wire.catalogGraph.variants[0]).not.toHaveProperty("sku");
  });

  it("compares image fields rather than JSON property insertion order", () => {
    const original = configured();
    const draft = draftFor(original);
    draft.variants[0]!.cardMedia = {
      hover: { altText: null, url: "/uploads/red-hover.webp", type: "IMAGE" },
      cover: { altText: "Red cover", url: "/uploads/red-card.webp", type: "IMAGE" },
    };
    expect(buildCatalogGraphPatch(original, draft).variantUpserts).toEqual([]);
  });

  it("treats omitted card metadata as unchanged rather than a clear", () => {
    const original = configured();
    const draft = draftFor(original);
    delete draft.variants[0]!.cardMedia;
    draft.variants[0]!.position = 4;
    const wire = toWireCatalogGraphPatch(buildCatalogGraphPatch(original, draft), original.catalogGraphVersion);
    expect(wire.catalogGraph.variants[0]).not.toHaveProperty("cardMedia");
  });

  it("keeps explicit snapshots on a new client-keyed variant without copying another row", () => {
    const original = configured();
    const draft = draftFor(original);
    draft.variants.push({ clientKey: "new-v", name: "Red", position: 2, combinationKey: "new-combo",
      optionValueRefs: [], sku: null, cardMedia: { cover: pair().hover, hover: null } });
    const wire = toWireCatalogGraphPatch(buildCatalogGraphPatch(original, draft), original.catalogGraphVersion);
    expect(wire.catalogGraph.variants).toEqual([{
      clientKey: "new-v", position: 2, optionValueRefs: [], cardMedia: { cover: pair().hover, hover: null },
    }]);
    expect(draft.variants[0]).toHaveProperty("cardMedia", pair());
  });

  it("preserves snapshots and identities in legacy deserialization", () => {
    const product = productFor(configured());
    delete product.options;
    delete product.media;
    const form = deserializeProduct(product);
    expect(form.graphTyped).toBe(false);
    expect(form.variants[0]).toHaveProperty("id", VARIANT_RED_ID);
    expect(form.variants[0]).toHaveProperty("cardMedia", pair());
    expect(form.graph!.variants[0]).toHaveProperty("cardMedia", pair());
  });
});

describe("card draft identities", () => {
  it("normalizes duplicate legacy value positions without changing real variant identity or position", () => {
    const product = productFor(serverGraph());
    delete product.options;
    delete product.media;
    const value = deserializeProduct(product);
    value.variants.forEach((row, index) => {
      row.position = "0";
      row.cardMedia = { cover: { type: "IMAGE", url: `/uploads/own-${index}.webp`, altText: null }, hover: null };
    });
    const graph = cardGraphFromLegacyForm(value);
    expect(graph.options[0]!.values.map(row => row.position)).toEqual([0, 1]);
    expect(graph.variants.map(row => [row.id, row.position, row.cardMedia?.cover?.url])).toEqual([
      [VARIANT_RED_ID, 0, "/uploads/own-0.webp"], [VARIANT_BLUE_ID, 0, "/uploads/own-1.webp"],
    ]);
    expect(validateAdminCatalogGraph(graph).issues).not.toContainEqual(expect.objectContaining({ code: "duplicate_value_position" }));
  });

  it("preserves reserved inventory as read-only draft context", () => {
    const original = serverGraph();
    original.variants[0]!.sku!.reserved = 3;
    const draft = draftFor(original);
    expect(draft.variants[0]!.sku).toMatchObject({ onHand: 4, reserved: 3 });
    draft.variants[0]!.sku!.price = 1500;
    const wire = toWireCatalogGraphPatch(buildCatalogGraphPatch(original, draft), original.catalogGraphVersion);
    expect(wire.catalogGraph.variants[0]!.sku).not.toHaveProperty("reserved");
    expect(wire.catalogGraph.variants[0]!.sku).not.toHaveProperty("onHand");
  });

  it("converts the latest reordered legacy fields while preserving real identities and unsaved stock", () => {
    const product = productFor(serverGraph());
    delete product.options;
    delete product.media;
    const value = deserializeProduct(product);
    value.variants.reverse();
    const row = value.variants.find(row => row.id === VARIANT_RED_ID)!;
    row.name = "Renamed red";
    row.position = "7";
    row.sku!.packageWidth = "55";
    row.sku!.stock = "9";
    row.sku!.reserved = "2";
    row.cardMedia = { cover: { type: "IMAGE", url: "/uploads/own.webp", altText: null }, hover: null };
    value.images[0]!.url = "/uploads/latest-pdp.webp";
    value.variants.push({ clientKey: "new-red", name: "Renamed red", position: "9", sku: null });
    const before = structuredClone(value);
    const graph = cardGraphFromLegacyForm(value);
    const converted = graph.variants.find(row => row.id === VARIANT_RED_ID)!;
    expect(converted).toMatchObject({ id: VARIANT_RED_ID, name: "Renamed red", position: 7,
      cardMedia: row.cardMedia, sku: { id: SKU_RED_ID, packageWidth: 55, onHand: 9, reserved: 2 } });
    expect(graph.variants.find(row => row.clientKey === "new-red")?.cardMedia ?? null).toBeNull();
    expect(graph.variants.map(row => row.id ?? row.clientKey)).toEqual([VARIANT_BLUE_ID, VARIANT_RED_ID, "new-red"]);
    expect(graph.options).toHaveLength(1);
    expect(graph.options[0]!.kind).toBe("STYLE");
    expect(graph.options[0]!.values.map(row => row.label)).toEqual(["Blue", "Renamed red", "Renamed red"]);
    expect(graph.defaultDisplayVariantRef).toEqual({ id: VARIANT_RED_ID });
    expect(graph.media[0]).toMatchObject({ id: MEDIA_1_ID, url: "/uploads/latest-pdp.webp" });
    expect(value).toEqual(before);
  });

  it("updates only the addressed slot and copies the selected image", () => {
    const graph = draftFor();
    const image = { type: "IMAGE" as const, url: "/uploads/cover.webp", altText: "Own cover" };
    setVariantCardImage(graph, { id: VARIANT_RED_ID }, "cover", image);
    setVariantCardImage(graph, { id: VARIANT_RED_ID }, "hover", { ...image, url: "/uploads/hover.webp" });
    image.url = "/changed.webp";
    expect(graph.variants[0]).toHaveProperty("cardMedia", {
      cover: { type: "IMAGE", url: "/uploads/cover.webp", altText: "Own cover" },
      hover: { type: "IMAGE", url: "/uploads/hover.webp", altText: "Own cover" },
    });
    setVariantCardImage(graph, { id: VARIANT_RED_ID }, "hover", null);
    expect(graph.variants[0]).toHaveProperty("cardMedia.hover", null);
    expect(graph.variants[0]).toHaveProperty("cardMedia.cover.url", "/uploads/cover.webp");
    expect(graph.variants[1]!.cardMedia ?? null).toBeNull();
  });

  it("keeps same-named client-keyed rows separate", () => {
    const graph = draftFor();
    graph.variants.push({ clientKey: "other-red", name: "Red", position: 2, combinationKey: "other", optionValueRefs: [], sku: null });
    setVariantCardImage(graph, { clientKey: "other-red" }, "cover", { type: "IMAGE", url: "/uploads/new.webp", altText: null });
    expect(graph.variants.find(row => row.clientKey === "other-red")).toHaveProperty("cardMedia.cover.url", "/uploads/new.webp");
    expect(graph.variants[0]!.cardMedia ?? null).toBeNull();
  });
});

describe("scene media drafts", () => {
  it("hydrates scene metadata and defaults older unmarked responses to false", () => {
    const graph = serverGraph();
    Object.assign(graph.media[0]!, { isScene: true });
    const draft = draftFor(graph);
    expect(draft.media.map(row => row.isScene)).toEqual([true, false]);
    expect(graphFromAdminProduct(productFor(graph)).media.map(row => row.isScene)).toEqual([true, false]);
  });

  it("preserves scene metadata in the legacy projection", () => {
    const product = productFor(serverGraph());
    delete product.options;
    delete product.media;
    Object.assign(product.images[0]!, { isScene: true });
    expect(deserializeAdminProduct(product).media[0]?.isScene).toBe(true);
  });

  it("emits only the scene-only changed row with an explicit boolean through the wire", () => {
    const graph = serverGraph();
    const draft = draftFor(graph);
    Object.assign(draft.media[1]!, { isScene: true });
    const patch = buildCatalogGraphPatch(graph, draft);
    expect(patch.mediaUpserts).toHaveLength(1);
    expect(patch.mediaUpserts[0]).toMatchObject({ id: MEDIA_2_ID, isScene: true });
    const wire = toWireCatalogGraphPatch(patch, graph.catalogGraphVersion);
    expect(wire.catalogGraph.media[0]).toMatchObject({ id: MEDIA_2_ID, isScene: true });
    expect(wire.catalogGraph.retirements.mediaIds).toEqual([]);
  });

  it("does not dirty an untouched draft when old responses omit the flag", () => {
    const graph = serverGraph();
    const draft = draftFor(graph);
    Object.assign(draft.media[0]!, { isScene: false });
    expect(buildCatalogGraphPatch(graph, draft).mediaUpserts).toEqual([]);
  });

  it("retains scene identity across shared reorder and URL edits", () => {
    const draft = draftFor();
    Object.assign(draft.media[0]!, { isScene: true });
    Object.assign(draft.media[1]!, { isScene: false });
    syncSharedMediaDraft(draft, [
      { id: MEDIA_2_ID, url: draft.media[1]!.url, type: "IMAGE", isScene: false },
      { id: MEDIA_1_ID, url: "/uploads/edited.webp", type: "IMAGE", isScene: true },
    ]);
    expect(draft.media.map(row => [row.id, row.url, row.isScene, row.sortOrder])).toEqual([
      [MEDIA_2_ID, "/uploads/catalog/2026/blue.jpg", false, 0],
      [MEDIA_1_ID, "/uploads/edited.webp", true, 1],
    ]);
  });

  it("uses stable ids even when two images have the same URL", () => {
    const draft = draftFor();
    draft.media.forEach((row, index) => Object.assign(row, { url: "/uploads/same.webp", isScene: index === 0 }));
    syncSharedMediaDraft(draft, [
      { id: MEDIA_2_ID, url: "/uploads/same.webp", type: "IMAGE", isScene: false },
      { id: MEDIA_1_ID, url: "/uploads/same.webp", type: "IMAGE", isScene: true },
    ]);
    expect(draft.media.map(row => [row.id, row.isScene])).toEqual([[MEDIA_2_ID, false], [MEDIA_1_ID, true]]);
  });

  it("keeps a new media client key and scene flag across edits", () => {
    const draft = draftFor();
    syncSharedMediaDraft(draft, [{ clientKey: "new-scene", url: "/uploads/new.webp", type: "IMAGE", isScene: true }]);
    syncSharedMediaDraft(draft, [{ clientKey: "new-scene", url: "/uploads/edited.webp", type: "IMAGE", isScene: true }]);
    expect(draft.media).toEqual([expect.objectContaining({ clientKey: "new-scene", url: "/uploads/edited.webp", isScene: true })]);
  });

  it("matches identity-free legacy inputs by unique URL/type rather than index", () => {
    const draft = draftFor();
    Object.assign(draft.media[0]!, { isScene: true });
    syncSharedMediaDraft(draft, [
      { url: draft.media[1]!.url, type: "IMAGE" },
      { url: draft.media[0]!.url, type: "IMAGE" },
    ]);
    expect(draft.media.map(row => [row.id, !!row.isScene])).toEqual([[MEDIA_2_ID, false], [MEDIA_1_ID, true]]);
  });

  it("refuses ambiguous legacy scene inheritance without modifying the draft", () => {
    const draft = draftFor();
    Object.assign(draft.media[0]!, { isScene: true });
    const before = structuredClone(draft);
    expect(() => syncSharedMediaDraft(draft, [
      { url: draft.media[0]!.url, type: "IMAGE" },
      { url: draft.media[0]!.url, type: "IMAGE" },
    ])).toThrow(/uniquely|ambiguous/i);
    expect(draft).toEqual(before);
  });

  it("does not transfer a removed scene to a new image in the same slot", () => {
    const draft = draftFor();
    Object.assign(draft.media[0]!, { isScene: true });
    syncSharedMediaDraft(draft, [{ url: "/uploads/replacement.webp", type: "IMAGE" }]);
    expect(draft.media[0]?.isScene).toBe(false);
    expect(draft.media[0]?.id).toBeUndefined();
    expect(buildCatalogGraphPatch(serverGraph(), draft).retirements.mediaIds).toEqual([MEDIA_1_ID, MEDIA_2_ID]);
  });

  it("clears scene metadata when the same identity becomes video", () => {
    const draft = draftFor();
    Object.assign(draft.media[0]!, { isScene: true });
    syncSharedMediaDraft(draft, [{ id: MEDIA_1_ID, url: draft.media[0]!.url, type: "VIDEO" }]);
    expect(draft.media[0]).toMatchObject({ id: MEDIA_1_ID, type: "VIDEO", isScene: false });
  });

  it("changes a shared scene without touching its order or scoped rows", () => {
    const draft = draftFor();
    draft.media[0]!.sortOrder = 2;
    draft.media[1]!.sortOrder = 5;
    const scoped = { id: "scoped", url: "/uploads/scoped.webp", type: "IMAGE" as const, altText: null, sortOrder: 0,
      optionValueRef: { id: RED_VALUE_ID }, variantRef: null, isScene: true };
    draft.media.push(scoped);
    syncSharedMediaDraft(draft, [
      { id: MEDIA_1_ID, url: draft.media[0]!.url, type: "IMAGE", sortOrder: "2", isScene: false },
      { id: MEDIA_2_ID, url: draft.media[1]!.url, type: "IMAGE", sortOrder: "5", isScene: true },
    ]);
    expect(draft.media.filter(row => !row.optionValueRef).map(row => [row.id, row.sortOrder, row.isScene]))
      .toEqual([[MEDIA_1_ID, 2, false], [MEDIA_2_ID, 5, true]]);
    expect(draft.media.find(row => row.id === "scoped")).toEqual(scoped);
  });
});

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

describe("live Default baseline preservation", () => {
  function fixture() {
    const draft = draftFor();
    const placeholder: AdminCatalogGraphDraft["variants"][number] = {
      clientKey: "variant-", name: "Default", position: 0, combinationKey: "", optionValueRefs: [],
      sku: {
        skuCode: "", status: "ACTIVE", isBundle: false, bundleVersion: 0, price: 4499, compareAtPrice: 4999, onHand: 0, reserved: 0,
        supplierSku: null, supplierCost: null, costCurrency: null, landedCost: null, productWidth: null, productDepth: null, productHeight: null, productWeight: null,
        packageWidth: null, packageHeight: null, packageDepth: null, packageWeight: null, volumetricWeight: null,
      },
    };
    draft.variants.unshift(placeholder);
    draft.defaultDisplayVariantRef = { clientKey: "variant-" };
    return { draft, placeholder };
  }

  it.each([true, false])("removes only the superseded price-only placeholder, with SKU=%s", withSku => {
    const { draft, placeholder } = fixture();
    if (!withSku) placeholder.sku = null;
    const realRows = structuredClone(draft.variants.slice(1));
    const options = structuredClone(draft.options);
    removeSupersededDefaultVariant(draft);
    expect(draft.variants).toEqual(realRows);
    expect(draft.options).toEqual(options);
    expect(draft.defaultDisplayVariantRef).toBeNull();
    removeSupersededDefaultVariant(draft);
    expect(draft.variants).toEqual(realRows);
  });

  it.each([
    ["skuCode", "DEFAULT"], ["id", "persisted-sku"], ["status", "DISABLED"], ["onHand", 6], ["reserved", 1],
    ["supplierSku", "SUP-1"], ["supplierCost", 0], ["costCurrency", "CNY"], ["landedCost", 12],
    ["productWeight", 1], ["packageWidth", 20], ["packageHeight", 30], ["packageDepth", 40],
    ["packageWeight", 2], ["volumetricWeight", 3], ["kind", "BUNDLE"], ["bundleComponents", []],
    ["isBundle", true], ["bundleVersion", 1], ["bundleDraft", { version: 0, components: [] }],
    ["bundleDefinition", { version: 0, components: [], availableInventory: 0 }],
  ])("retains meaningful Default SKU configuration %s=%j", (key, value) => {
    const { draft, placeholder } = fixture();
    Object.assign(placeholder.sku!, { [key]: value });
    const before = structuredClone(draft);
    removeSupersededDefaultVariant(draft);
    expect(draft).toEqual(before);
  });

  it.each(["persisted", "references", "card-cover", "card-hover", "scoped-media", "different-client", "real-combination"])("retains Default with %s", kind => {
    const { draft, placeholder } = fixture();
    if (kind === "persisted") placeholder.id = "persisted-variant";
    if (kind === "references") placeholder.hasReferences = true;
    if (kind === "card-cover" || kind === "card-hover") placeholder.cardMedia = { cover: null, hover: null, [kind === "card-cover" ? "cover" : "hover"]: { type: "IMAGE", url: "/uploads/default.webp", altText: null } };
    if (kind === "scoped-media") draft.media.push({ url: "/uploads/default.webp", type: "IMAGE", altText: null, sortOrder: 0, optionValueRef: null, variantRef: { clientKey: "variant-" } });
    if (kind === "different-client") placeholder.clientKey = "another-default";
    if (kind === "real-combination") placeholder.optionValueRefs = [{ id: RED_VALUE_ID }];
    const before = structuredClone(draft);
    removeSupersededDefaultVariant(draft);
    expect(draft).toEqual(before);
  });

  it.each(["none", "disabled", "empty-values"])("keeps Default when options are %s", kind => {
    const { draft } = fixture();
    if (kind === "none") draft.options = [];
    if (kind === "disabled") draft.options.forEach(option => { option.isActive = false; });
    if (kind === "empty-values") draft.options[0].values = [];
    const before = structuredClone(draft);
    removeSupersededDefaultVariant(draft);
    expect(draft).toEqual(before);
  });

  it("keeps the selected real variant when removing an unused placeholder", () => {
    const { draft } = fixture();
    draft.defaultDisplayVariantRef = { id: VARIANT_RED_ID };
    removeSupersededDefaultVariant(draft);
    expect(draft.defaultDisplayVariantRef).toEqual({ id: VARIANT_RED_ID });
    expect(draft.variants.some(row => row.clientKey === "variant-")).toBe(false);
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
        isBundle: false,
        bundleVersion: 0,
        supplierSku: null,
        supplierCost: null,
        costCurrency: null,
        landedCost: null,
        price: 1599,
        compareAtPrice: null,
        productWidth: null, productDepth: null, productHeight: null, productWeight: null,
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
        isBundle: false,
        bundleVersion: 0,
        supplierSku: null,
        supplierCost: null,
        costCurrency: null,
        landedCost: null,
        price: 1599,
        compareAtPrice: null,
        productWidth: null, productDepth: null, productHeight: null, productWeight: null,
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
        id: row.id,
        clientKey: row.clientKey,
        url: row.url,
        type: row.type,
        altText: row.altText ?? "",
        sortOrder: String(index),
        isScene: row.isScene ?? false,
      }));
  }

  it("leaves the draft byte-identical when the gallery already matches", () => {
    const draft = draftFor();
    const before = structuredClone(draft);

    syncSharedMediaDraft(draft, sharedForm(draft));

    expect(draft).toEqual(before);
  });

  it("overlays edits by stable identity, keeps persisted ids and mints client keys for net-new rows", () => {
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
        isBundle: false,
        bundleVersion: 0,
        supplierSku: null,
        supplierCost: null,
        costCurrency: null,
        landedCost: null,
        price: 1599,
        compareAtPrice: null,
        productWidth: null, productDepth: null, productHeight: null, productWeight: null,
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
        isBundle: false,
        bundleVersion: 0,
        supplierSku: null,
        supplierCost: null,
        costCurrency: null,
        landedCost: null,
        price: null,
        compareAtPrice: null,
        productWidth: null, productDepth: null, productHeight: null, productWeight: null,
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

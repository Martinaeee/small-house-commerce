import { describe, expect, it } from "vitest";
import { applyProductDimensionsToVariants, canonicalCombinationKey, type AdminCatalogGraphDraft, type AdminSkuDraft } from "./admin-product-graph";
import {
  PHYSICAL_FIELDS,
  deriveAdminPhysicalSpecificationGroups,
  applyAdminPhysicalSpecificationPatch,
  inheritNewColorPhysicalSpecifications,
} from "./admin-physical-specs";

function sku(key: string): AdminSkuDraft {
  return {
    id: `sku-${key}`, skuCode: key, status: "ACTIVE", isBundle: false, bundleVersion: 0,
    supplierSku: null, supplierCost: null, costCurrency: null, landedCost: null,
    price: key === "red" ? 100 : 200, compareAtPrice: null,
    productWidth: null, productDepth: null, productHeight: null, productWeight: null,
    packageWidth: null, packageDepth: null, packageHeight: null, packageWeight: null,
    volumetricWeight: null, onHand: key === "red" ? 5 : 9,
  };
}
function fixture(): AdminCatalogGraphDraft {
  return {
    catalogGraphVersion: 1, defaultDisplayVariantRef: null, media: [],
    options: [{
      id: "color", kind: "COLOR", name: "Color", position: 0,
      presentation: "SWATCH", isMediaDriver: true, isActive: true,
      values: ["red", "blue"].map((id, position) => ({
        id, label: id, position, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null, isActive: true,
      })),
    }],
    variants: ["red", "blue"].map((id, position) => ({
      id: `variant-${id}`, name: id, position,
      combinationKey: canonicalCombinationKey([{ optionId: "color", valueId: id }]),
      optionValueRefs: [{ id }], sku: sku(id),
    })),
  };
}

describe("product defaults at the group boundary", () => {
  it("never copies product dimensions into a virtual Bundle", () => {
    const draft = fixture();
    draft.variants[1].sku!.isBundle = true;
    draft.variants[1].sku!.productWidth = 999;
    applyProductDimensionsToVariants(draft, { width: 80, depth: 50, height: 70 }, "all");
    expect(draft.variants.map(v => v.sku?.productWidth)).toEqual([80, 999]);
  });

  it("does not overwrite a mixed color axis through fill-empty", () => {
    const draft = fixture();
    draft.variants[0].sku!.productWidth = 120;
    applyProductDimensionsToVariants(draft, { width: 80, depth: 50, height: 70 }, "empty-only");
    expect(draft.variants.map(v => v.sku?.productWidth)).toEqual([120, null]);
    expect(draft.variants.map(v => v.sku?.productDepth)).toEqual([50, 50]);
    expect(draft.variants.map(v => v.sku?.productHeight)).toEqual([70, 70]);
  });

  it("fills distinct non-color groups independently", () => {
    const draft = fixture();
    draft.options[0].kind = "SIZE";
    draft.variants[0].sku!.productWidth = 120;
    applyProductDimensionsToVariants(draft, { width: 80, depth: 50, height: 70 }, "empty-only");
    expect(draft.variants.map(v => v.sku?.productWidth)).toEqual([120, 80]);
  });
});

describe("admin physical specification groups", () => {
  it("combines only typed colors and keeps identities, prices and stock independent", () => {
    const draft = fixture();
    const groups = deriveAdminPhysicalSpecificationGroups(draft);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: '["SKU"]', memberVariantKeys: ["variant-red", "variant-blue"], colors: ["red", "blue"], conflicts: [] });
    expect(draft.variants.map(v => v.sku?.price)).toEqual([100, 200]);
    expect(draft.variants.map(v => v.sku?.onHand)).toEqual([5, 9]);
  });

  it.each(PHYSICAL_FIELDS)("applies an explicit %s patch without mutating its input", field => {
    const draft = fixture();
    const next = applyAdminPhysicalSpecificationPatch(draft, '["SKU"]', { [field]: 120 });
    expect(next.variants.map(v => v.sku?.[field])).toEqual([120, 120]);
    expect(draft.variants.map(v => v.sku?.[field])).toEqual([null, null]);
    expect(next.variants.map(v => v.sku?.price)).toEqual([100, 200]);
    expect(next.variants.map(v => v.sku?.onHand)).toEqual([5, 9]);
  });

  it("distinguishes null inheritance from an explicit zero", () => {
    const draft = fixture();
    draft.variants[0].sku!.productWidth = 0;
    expect(deriveAdminPhysicalSpecificationGroups(draft)[0].conflicts).toEqual(["productWidth"]);
    const next = applyAdminPhysicalSpecificationPatch(draft, '["SKU"]', { productWidth: null });
    expect(next.variants.map(v => v.sku?.productWidth)).toEqual([null, null]);
  });

  it.each(["STYLE", "SIZE", "MATERIAL"] as const)("does not infer sharing from color-like labels of %s", kind => {
    const draft = fixture();
    draft.options[0].kind = kind;
    expect(deriveAdminPhysicalSpecificationGroups(draft).map(g => g.key))
      .toEqual(['["SKU",["color","red"]]', '["SKU",["color","blue"]]']);
  });

  it("preserves stable grouping through rename and reorder", () => {
    const draft = fixture();
    draft.options[0].name = "Paint";
    draft.options[0].values[0].label = "Ruby";
    draft.options[0].values.reverse();
    draft.variants.reverse();
    expect(deriveAdminPhysicalSpecificationGroups(draft)[0]).toMatchObject({ key: '["SKU"]' });
  });

  it("supports new clientKey identities", () => {
    const draft = fixture();
    draft.options[0].clientKey = draft.options[0].id;
    delete draft.options[0].id;
    for (const value of draft.options[0].values) { value.clientKey = value.id; delete value.id; }
    for (const variant of draft.variants) {
      variant.clientKey = variant.id; delete variant.id;
      variant.optionValueRefs = variant.optionValueRefs.map(ref => ({ clientKey: ref.id }));
    }
    expect(deriveAdminPhysicalSpecificationGroups(draft)[0].memberVariantKeys).toEqual(["variant-red", "variant-blue"]);
  });

  it("excludes unmaterialized, disabled and superseded rows", () => {
    const draft = fixture();
    draft.variants[1].sku!.status = "DISABLED";
    draft.variants.push({ id: "retained", name: "Default", position: 9, combinationKey: "old", optionValueRefs: [], sku: sku("retained") });
    const groups = deriveAdminPhysicalSpecificationGroups(draft);
    expect(groups[0].memberVariantKeys).toEqual(["variant-red"]);
    expect(applyAdminPhysicalSpecificationPatch(draft, groups[0].key, { packageWeight: 5 }).variants.map(v => v.sku?.packageWeight)).toEqual([5, null, null]);
    draft.variants[0].sku = null;
    expect(deriveAdminPhysicalSpecificationGroups(draft)).toEqual([]);
  });

  it("does not create any candidate SKU merely by deriving groups", () => {
    const draft = fixture();
    draft.variants = [];
    expect(deriveAdminPhysicalSpecificationGroups(draft)).toEqual([]);
    expect(draft.variants).toEqual([]);
  });

  it("separates Bundle packaging and ignores its own product axes", () => {
    const draft = fixture();
    draft.variants[1].sku!.isBundle = true;
    const groups = deriveAdminPhysicalSpecificationGroups(draft);
    expect(groups.map(g => g.key)).toEqual(['["SKU"]', '["BUNDLE"]']);
    const next = applyAdminPhysicalSpecificationPatch(draft, '["BUNDLE"]', { productWidth: 999, packageWeight: 8 });
    expect(next.variants.map(v => v.sku?.productWidth)).toEqual([null, null]);
    expect(next.variants.map(v => v.sku?.packageWeight)).toEqual([null, 8]);
  });

  it("inherits a consistent group only into the new color without changing its commercial fields", () => {
    const draft = fixture();
    draft.variants[0].sku!.productWidth = 120;
    draft.variants[0].sku!.packageWeight = 5;
    delete draft.variants[1].sku!.id;
    const result = inheritNewColorPhysicalSpecifications(draft, "variant-blue");
    expect(result.conflicts).toEqual([]);
    expect(result.draft.variants[1].sku).toMatchObject({ productWidth: 120, packageWeight: 5, price: 200, onHand: 9 });
    expect(draft.variants[1].sku?.packageWeight).toBeNull();
  });

  it("does not choose an arbitrary source for a new color with conflicting existing data", () => {
    const draft = fixture();
    draft.variants[0].sku!.packageWeight = 5;
    draft.variants[1].sku!.packageWeight = 8;
    const greenValue = { ...draft.options[0].values[0], id: "green", label: "green", position: 2 };
    draft.options[0].values.push(greenValue);
    const green = {
      id: "variant-green", name: "green", position: 2,
      combinationKey: canonicalCombinationKey([{ optionId: "color", valueId: "green" }]),
      optionValueRefs: [{ id: "green" }], sku: sku("green"),
    };
    delete green.sku.id;
    draft.variants.push(green);
    const original = structuredClone(draft);
    const result = inheritNewColorPhysicalSpecifications(draft, "variant-green");
    expect(result.conflicts).toEqual(["packageWeight"]);
    expect(result.draft).toEqual(original);
  });

  it("does not discard stored data on reactivation", () => {
    const draft = fixture();
    draft.variants[0].sku!.packageWeight = 5;
    draft.variants[1].sku!.packageWeight = 8;
    const result = inheritNewColorPhysicalSpecifications(draft, "variant-blue");
    expect(result.conflicts).toEqual(["packageWeight"]);
    expect(result.draft.variants[1].sku?.packageWeight).toBe(8);
  });

  it("does not change the existing two-option and 100-candidate constraints", () => {
    const draft = fixture();
    draft.options.push({ ...draft.options[0], id: "other", kind: "SIZE" }, { ...draft.options[0], id: "third", kind: "MATERIAL" });
    expect(deriveAdminPhysicalSpecificationGroups(draft)).toEqual([]);
  });
});

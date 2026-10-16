import { describe, expect, it } from "vitest";
import type { BundleComponentSpecification, StorefrontSku } from "@/lib/api";
import { hasPdpSpecificationDimensions, pdpSpecsVisible, resolveSelectedPdpSpecifications } from "./pdp-facts";

const product = { width: 999, depth: 50, height: 80, foldedWidth: 90, foldedDepth: null, foldedHeight: null, materials: "Parent", features: "Feature" };
const sku: StorefrontSku = { id: "sku", skuCode: "SKU", status: "ACTIVE", price: 100, compareAtPrice: null, availableInventory: 0 };
const component: BundleComponentSpecification = {
  productName: "Chair", variantName: "Oak", quantity: 4, width: 45, depth: null, height: 0,
  foldedWidth: null, foldedDepth: null, foldedHeight: null, productWeight: 4, materials: "Wood",
};
const noDimensions = { ...component, width: null, depth: null, height: null, foldedWidth: null, foldedDepth: null, foldedHeight: null };

describe("selected PDP specification source", () => {
  it("preserves ordinary per-axis inheritance, explicit zero and product folded data", () => {
    expect(resolveSelectedPdpSpecifications(product, { ...sku, productWidth: 0, productDepth: null, productHeight: 75, productWeight: 0 })).toEqual({
      kind: "SKU", product: { ...product, width: 0, depth: 50, height: 75 }, productWeight: 0,
    });
  });
  it("retains product-only and older ordinary-SKU callers", () => {
    expect(resolveSelectedPdpSpecifications(product)).toEqual({ kind: "SKU", product, productWeight: null });
    expect(resolveSelectedPdpSpecifications(product, sku)).toEqual({ kind: "SKU", product, productWeight: null });
  });
  it("takes only component specifications for a Bundle regardless of parent or own SKU axes", () => {
    expect(resolveSelectedPdpSpecifications(product, { ...sku, specificationSource: "BUNDLE_COMPONENTS", productWidth: 999, bundleComponents: [component] }))
      .toEqual({ kind: "BUNDLE_COMPONENTS", components: [component], features: "Feature" });
  });
  it.each([{ components: [] }, { components: undefined }])("never falls back to parent specifications when Bundle components are %j", ({ components }) => {
    const resolved = resolveSelectedPdpSpecifications(product, { ...sku, specificationSource: "BUNDLE_COMPONENTS", bundleComponents: components });
    expect(resolved).toEqual({ kind: "BUNDLE_COMPONENTS", components: [], features: "Feature" });
    expect(hasPdpSpecificationDimensions(resolved)).toBe(false);
    expect(pdpSpecsVisible(product, 99, resolved)).toBe(false);
  });
  it("counts zero as a real component dimension", () => {
    expect(hasPdpSpecificationDimensions({ kind: "BUNDLE_COMPONENTS", components: [{ ...noDimensions, height: 0 }], features: null })).toBe(true);
  });
  it("does not offer dimensions for materials-only or name-only components but retains their section", () => {
    const resolved = { kind: "BUNDLE_COMPONENTS" as const, components: [noDimensions], features: null };
    expect(hasPdpSpecificationDimensions(resolved)).toBe(false);
    expect(pdpSpecsVisible(product, 99, resolved)).toBe(true);
  });
  it("recognizes folded-only dimensions without using quantity as a measurement", () => {
    expect(hasPdpSpecificationDimensions({ kind: "BUNDLE_COMPONENTS", components: [{ ...noDimensions, foldedDepth: 8 }], features: null })).toBe(true);
  });
});

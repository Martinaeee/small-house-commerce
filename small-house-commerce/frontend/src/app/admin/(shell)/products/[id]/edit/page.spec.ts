import { describe, expect, it } from "vitest";
import { deserializeProduct } from "@/app/admin/(shell)/products/[id]/edit/page";
import type { AdminProduct } from "@/lib/admin-api";

/**
 * Regression cover for the admin edit form's server-truth mapping.
 *
 * The form adopts the PATCH response as its new server truth after every
 * save. When the backend returned the raw row (no inventory enrichment),
 * `String(sku.onHand)` produced "undefined", the stock validator rejected it,
 * and the Save button silently stopped sending anything — so every edit after
 * the first looked like it had no effect on the storefront.
 */

function productWith(overrides: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: "p1",
    name: "Chair",
    slug: "chair",
    description: null,
    tagline: null,
    categoryId: "c1",
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
    images: [],
    detailBlocks: [],
    variants: [
      {
        id: "v1",
        name: "Default",
        position: 0,
        sku: {
          id: "sku1",
          skuCode: "CODE-1",
          status: "ACTIVE",
          supplierId: null,
          supplierSku: null,
          supplierCost: null,
          costCurrency: null,
          landedCost: null,
          price: "1299",
          compareAtPrice: null,
          productWeight: null,
          packageWidth: null,
          packageHeight: null,
          packageDepth: null,
          packageWeight: null,
          volumetricWeight: null,
          onHand: 4,
          reserved: 1,
          availableInventory: 3,
        },
      },
    ],
    ...overrides,
  } as AdminProduct;
}

describe("deserializeProduct — stock", () => {
  it("maps the inventory figures into the editable stock box", () => {
    const value = deserializeProduct(productWith());

    expect(value.variants[0].sku?.stock).toBe("4");
    expect(value.variants[0].sku?.reserved).toBe("1");
  });

  it("falls back to an empty box when the response carries no inventory figures", () => {
    // A response without onHand must not become the string "undefined" —
    // that fails validateStockEntry and blocks every later save.
    const product = productWith();
    const sku = product.variants[0].sku as unknown as Record<string, unknown>;
    delete sku.onHand;
    delete sku.reserved;

    const value = deserializeProduct(product);

    expect(value.variants[0].sku?.stock).toBe("");
    expect(value.variants[0].sku?.reserved).toBe("");
  });
});

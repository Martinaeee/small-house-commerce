import { describe, expect, it } from "vitest";
import { emptyProductFormValue, emptySkuFormValue } from "@/components/admin/ProductForm";
import { cardGraphFromLegacyForm, type AdminCatalogGraphDraft } from "@/lib/admin-product-graph";
import { buildProductCardPreview } from "@/lib/admin-product-card-preview";

function fixture() {
  const value = emptyProductFormValue();
  value.name = "Preview table";
  value.slug = "preview-table";
  value.categoryId = "category";
  value.width = "120";
  value.height = "75";
  value.depth = "60";
  value.images = [{ url: "/uploads/pdp.png", type: "IMAGE", altText: "PDP", sortOrder: "0" }];
  const draft: AdminCatalogGraphDraft = {
    catalogGraphVersion: 0, defaultDisplayVariantRef: null, options: [], media: [],
    variants: [{ clientKey: "v1", name: "Single", position: 0, combinationKey: "", optionValueRefs: [], sku: null,
      cardMedia: { cover: { type: "IMAGE", url: "/uploads/card.png", altText: null }, hover: null } }],
  };
  return { value, draft };
}

describe("buildProductCardPreview", () => {
  it("keeps card images out of the PDP gallery and leaves input state untouched", () => {
    const { value, draft } = fixture();
    const before = structuredClone({ value, draft });
    const preview = buildProductCardPreview(value, draft, { clientKey: "v1" });
    expect(preview.images.map(image => image.url)).toEqual(["/uploads/pdp.png"]);
    expect(preview.cardMedia?.variants.find(row => row.variantId === "v1")?.cover?.url).toBe("/uploads/card.png");
    expect(preview.cardMedia?.displayVariantId).toBe("v1");
    expect(preview.cardMedia?.unselected.cover?.url).toBe("/uploads/card.png");
    expect(preview.variants[0]!.sku).toBeNull();
    expect({ value, draft }).toEqual(before);
  });

  it("maps current scalar values and dimensions rather than using another product", () => {
    const { value, draft } = fixture();
    value.tagline = "Latest tagline";
    value.foldedWidth = "";
    value.foldedHeight = "20";
    value.foldedDepth = "30";
    expect(buildProductCardPreview(value, draft, null)).toMatchObject({
      name: "Preview table", slug: "preview-table", categoryId: "category", tagline: "Latest tagline",
      width: 120, height: 75, depth: 60, foldedWidth: null, foldedHeight: 20, foldedDepth: 30,
    });
  });

  it("keeps the preview selection local and never infers an omitted selection", () => {
    const { value, draft } = fixture();
    draft.defaultDisplayVariantRef = { clientKey: "v1" };
    const preview = buildProductCardPreview(value, draft, null);
    expect(preview.cardMedia).toMatchObject({ displayVariantId: null, unselected: { cover: null, scene: null } });
    expect(draft.defaultDisplayVariantRef).toEqual({ clientKey: "v1" });
  });

  it("ignores a vanished preview target", () => {
    const { value, draft } = fixture();
    expect(buildProductCardPreview(value, draft, { id: "foreign" }).cardMedia).toMatchObject({
      displayVariantId: null, unselected: { cover: null, scene: null },
    });
  });

  it("keeps a missing cover empty instead of borrowing a hover or gallery image", () => {
    const { value, draft } = fixture();
    draft.variants[0]!.cardMedia = { cover: null, hover: { type: "IMAGE", url: "/uploads/hover.png", altText: null } };
    expect(buildProductCardPreview(value, draft, { clientKey: "v1" }).cardMedia).toMatchObject({
      unselected: { cover: null, scene: null }, variants: [{ variantId: "v1", cover: null, scene: null }],
    });
  });

  it("maps current SKU price and reserved inventory without leaking private fields", () => {
    const { value } = fixture();
    value.graphTyped = false;
    value.variants = [{ id: "real-v", name: "Red", position: "0", sku: {
      ...emptySkuFormValue(), id: "real-sku", skuCode: "RED", price: "0", compareAtPrice: "120",
      stock: "8", reserved: "3", supplierCost: "10", packageWidth: "55",
    }, cardMedia: { cover: { type: "IMAGE", url: "/uploads/red.webp", altText: null }, hover: null } }];
    const draft = cardGraphFromLegacyForm(value);
    const preview = buildProductCardPreview(value, draft, { id: "real-v" });
    expect(preview.variants[0]).toMatchObject({ id: "real-v", sku: {
      id: "real-sku", price: 0, compareAtPrice: 120, availableInventory: 5, packageWidth: 55,
    } });
    expect(JSON.stringify(preview)).not.toMatch(/supplierCost|supplierSku|landedCost|reserved|onHand/);
    draft.variants[0]!.sku!.price = null;
    draft.variants[0]!.sku!.onHand = 1;
    expect(buildProductCardPreview(value, draft, { id: "real-v" }).variants[0]!.sku).toMatchObject({
      price: null, availableInventory: 0,
    });
  });

  it("maps option refs and independent pairs from the same draft", () => {
    const { value, draft } = fixture();
    draft.options = [{ clientKey: "color", kind: "COLOR", name: "Color", position: 0, presentation: "SWATCH",
      isActive: true, isMediaDriver: true, values: [
        { clientKey: "red", label: "Red", position: 0, swatchHex: "#ff0000", thumbnailUrl: null, thumbnailAlt: null, isActive: true },
      ] }];
    draft.variants[0]!.optionValueRefs = [{ clientKey: "red" }];
    const preview = buildProductCardPreview(value, draft, { clientKey: "v1" });
    expect(preview.options[0]).toMatchObject({ id: "color", values: [{ id: "red", label: "Red" }] });
    expect(preview.variants[0]).toMatchObject({ id: "v1", optionValueIds: ["red"] });
    expect(preview.cardMedia!.variants[0]).toMatchObject({ variantId: "v1", cover: { id: "card:v1:cover" } });
  });

  it("leaves admin-hidden feature bullets out of the preview product", () => {
    const { value, draft } = fixture();
    value.features = ["Folds flat", "[hidden] Internal note"];
    expect(buildProductCardPreview(value, draft, null).features).toBe("Folds flat");
  });
});

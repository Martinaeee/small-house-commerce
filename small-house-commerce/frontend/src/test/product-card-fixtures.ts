import type { Product } from "@/lib/api";

export function cardTestProduct(overrides: Partial<Product> = {}): Product {
  const cover = { id: "cover", url: "/cover.webp", type: "IMAGE" as const, altText: "Cover", sortOrder: 0 };
  return {
    id: "product-1", name: "Oak Side Table", slug: "oak-side-table", categoryId: "category-1",
    description: null, tagline: null, ratingAverage: null, reviewCount: 0,
    room: null, internalRole: null, solutions: [], width: null, height: null, depth: null,
    foldedWidth: null, foldedHeight: null, foldedDepth: null,
    catalogGraphVersion: 1, defaultDisplayVariantId: null, effectiveCoverMedia: cover, images: [cover],
    options: [{ id: "color", kind: "COLOR", name: "Color", position: 0,
      presentation: "TEXT", isMediaDriver: true, values: [
        { id: "red", label: "Red", position: 0, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
        { id: "blue", label: "Blue", position: 1, swatchHex: null, thumbnailUrl: null, thumbnailAlt: null },
      ] }],
    variants: [
      { id: "red-variant", name: "Red", position: 0, combinationKey: "color:red", optionValueIds: ["red"],
        sku: { id: "red-sku", skuCode: "RED", status: "ACTIVE", price: 100, compareAtPrice: 130, availableInventory: 4 } },
      { id: "blue-variant", name: "Blue", position: 1, combinationKey: "color:blue", optionValueIds: ["blue"],
        sku: { id: "blue-sku", skuCode: "BLUE", status: "ACTIVE", price: 120, compareAtPrice: 150, availableInventory: 4 } },
    ],
    ...overrides,
  };
}

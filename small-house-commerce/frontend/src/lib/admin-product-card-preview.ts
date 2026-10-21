import type { ProductFormValue } from "@/components/admin/ProductForm";
import type { Product, ProductCardMediaPair } from "@/lib/api";
import { entityRowKey, type AdminCatalogGraphDraft, type EntityRef } from "@/lib/admin-product-graph";

function number(raw: string): number | null {
  if (raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildProductCardPreview(
  value: ProductFormValue,
  draft: AdminCatalogGraphDraft,
  displayVariantRef: EntityRef | null,
): Product {
  const images = value.images.filter(image => image.url.trim() !== "").map((image, index) => ({
    id: image.id ?? image.clientKey ?? `preview-gallery-${index}`, url: image.url, type: image.type,
    altText: image.altText || null, sortOrder: number(image.sortOrder) ?? index,
  }));
  const variants = draft.variants.map(row => ({
    id: entityRowKey(row), name: row.name, position: row.position, combinationKey: row.combinationKey,
    optionValueIds: row.optionValueRefs.map(entityRowKey),
    sku: row.sku ? {
      id: row.sku.id ?? row.sku.clientKey ?? `${entityRowKey(row)}-sku`, skuCode: row.sku.skuCode,
      status: row.sku.status, price: row.sku.price, compareAtPrice: row.sku.compareAtPrice,
      productWidth: row.sku.productWidth, productHeight: row.sku.productHeight, productDepth: row.sku.productDepth,
      productWeight: row.sku.productWeight, packageWidth: row.sku.packageWidth,
      packageHeight: row.sku.packageHeight, packageDepth: row.sku.packageDepth, packageWeight: row.sku.packageWeight,
      availableInventory: Math.max(0, row.sku.onHand - (row.sku.reserved ?? 0)),
    } : null,
  }));
  const pairs = draft.variants.map(row => {
    const variantId = entityRowKey(row);
    const cover = row.cardMedia?.cover;
    const hover = row.cardMedia?.hover;
    const pair: ProductCardMediaPair = cover ? {
      cover: { id: `card:${variantId}:cover`, type: "IMAGE", url: cover.url, altText: cover.altText, sortOrder: 0 },
      scene: hover ? { id: `card:${variantId}:hover`, type: "IMAGE", url: hover.url, altText: hover.altText, sortOrder: 0 } : null,
    } : { cover: null, scene: null };
    return { variantId, ...pair };
  });
  const displayPair = displayVariantRef === null ? undefined
    : pairs.find(row => row.variantId === entityRowKey(displayVariantRef));
  const displayVariantId = displayPair?.variantId ?? null;
  return {
    id: "product-card-preview", name: value.name, slug: value.slug, categoryId: value.categoryId,
    description: value.description || null, tagline: value.tagline || null,
    seoTitle: value.seoTitle || null, metaDescription: value.metaDescription || null,
    ratingAverage: null, reviewCount: 0, room: (value.room || null) as Product["room"],
    internalRole: value.internalRole || null, solutions: [...value.solutions] as Product["solutions"],
    width: number(value.width), height: number(value.height), depth: number(value.depth),
    foldedWidth: number(value.foldedWidth), foldedHeight: number(value.foldedHeight), foldedDepth: number(value.foldedDepth),
    materials: value.materials || null, features: value.features.join("\n") || null,
    catalogGraphVersion: draft.catalogGraphVersion,
    options: draft.options.filter(option => option.isActive).map(option => ({
      id: entityRowKey(option), kind: option.kind, name: option.name, position: option.position,
      presentation: option.presentation, isMediaDriver: option.isMediaDriver,
      values: option.values.filter(row => row.isActive).map(row => ({
        id: entityRowKey(row), label: row.label, position: row.position, swatchHex: row.swatchHex,
        thumbnailUrl: row.thumbnailUrl, thumbnailAlt: row.thumbnailAlt,
      })),
    })),
    defaultDisplayVariantId: displayVariantId,
    effectiveCoverMedia: images[0] ?? null, images, variants,
    cardMedia: {
      displayVariantId,
      unselected: displayPair ? { cover: displayPair.cover, scene: displayPair.scene } : { cover: null, scene: null },
      variants: pairs,
    },
  };
}

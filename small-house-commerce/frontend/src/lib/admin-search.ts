import type {
  AdminSearchHit,
  AdminSearchResponse,
  ProductSearchHit,
} from "./admin-api";

export const ADMIN_SEARCH_GROUPS = [
  "products",
  "orders",
  "customers",
  "shipments",
] as const;

export type AdminSearchGroupKey = (typeof ADMIN_SEARCH_GROUPS)[number];

export interface FlatAdminSearchResult {
  group: AdminSearchGroupKey;
  hit: AdminSearchHit;
}

export function flattenAdminSearchResults(
  response: AdminSearchResponse,
): FlatAdminSearchResult[] {
  return [
    ...(response.groups.products?.items.map((hit) => ({
      group: "products" as const,
      hit,
    })) ?? []),
    ...(response.groups.orders?.items.map((hit) => ({
      group: "orders" as const,
      hit,
    })) ?? []),
    ...(response.groups.customers?.items.map((hit) => ({
      group: "customers" as const,
      hit,
    })) ?? []),
    ...(response.groups.shipments?.items.map((hit) => ({
      group: "shipments" as const,
      hit,
    })) ?? []),
  ];
}

function productHref(hit: ProductSearchHit): string {
  const base = `/admin/products/${encodeURIComponent(hit.productId)}/edit`;
  if (hit.matchedSku === null) return base;
  return `${base}?section=variants&sku=${encodeURIComponent(hit.matchedSku.skuCode)}`;
}

export function adminSearchHitHref(hit: AdminSearchHit): string {
  switch (hit.kind) {
    case "PRODUCT":
      return productHref(hit);
    case "ORDER":
      return `/admin/orders/${encodeURIComponent(hit.orderId)}`;
    case "CUSTOMER":
      return `/admin/customers/${encodeURIComponent(hit.customerId)}`;
    case "SHIPMENT":
      return `/admin/orders/${encodeURIComponent(hit.orderId)}#shipments`;
  }
}

export function adminSearchOptionId(hit: AdminSearchHit): string {
  switch (hit.kind) {
    case "PRODUCT":
      return hit.matchedSku === null
        ? `search-product-${hit.productId}`
        : `search-product-${hit.productId}-sku-${hit.matchedSku.skuId}`;
    case "ORDER":
      return `search-order-${hit.orderId}`;
    case "CUSTOMER":
      return `search-customer-${hit.customerId}`;
    case "SHIPMENT":
      return `search-shipment-${hit.shipmentId}`;
  }
}

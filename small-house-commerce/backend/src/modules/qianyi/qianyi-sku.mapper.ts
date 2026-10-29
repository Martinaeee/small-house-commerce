/**
 * Readiness of a catalog SKU before it can be mapped to an existing Qianyi SKU.
 *
 * Qianyi requires gross weight, net weight and all three dimensions when its
 * staff create the SKU there. We never invent a number: a SKU that lacks a
 * dimension is reported as not ready so the operator knows what to fill in
 * before binding its Qianyi code.
 *
 * Our schema stores the package as width × depth × height in cm, which is
 * exactly Qianyi's length × width × height.
 */
export interface SkuSource {
  id: string;
  skuCode: string;
  packageWeight: number | null;
  packageWidth: number | null;
  packageHeight: number | null;
  packageDepth: number | null;
  productWeight: number | null;
  product: { name: string; description: string | null };
  images: Array<{ url: string }>;
}

export interface SkuReadiness {
  ready: boolean;
  gaps: string[];
}

export function skuReadiness(sku: SkuSource): SkuReadiness {
  const gaps: string[] = [];
  if (!sku.packageWeight) gaps.push('packageWeight');
  // Net weight is a required Qianyi field and comes from the product record.
  // Falling back to the gross weight would ship a number we know is wrong, so
  // a SKU without it is reported instead.
  if (!sku.productWeight) gaps.push('productWeight');
  if (!sku.packageWidth) gaps.push('packageWidth');
  if (!sku.packageHeight) gaps.push('packageHeight');
  if (!sku.packageDepth) gaps.push('packageDepth');
  return { ready: gaps.length === 0, gaps };
}

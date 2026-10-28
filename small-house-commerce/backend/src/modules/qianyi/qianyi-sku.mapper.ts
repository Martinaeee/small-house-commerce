/**
 * Turns a catalog SKU into `INSERT_SKU_INFO`.
 *
 * Qianyi requires gross weight, net weight and all three dimensions. We never
 * invent a number: a SKU that lacks a dimension is reported as not ready and
 * stays out of the creation list until someone fills it in.
 *
 * Our schema stores the package as width × depth × height in cm, which is
 * exactly Qianyi's length × width × height, so no axis is swapped.
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
  if (!sku.packageWidth) gaps.push('packageWidth');
  if (!sku.packageHeight) gaps.push('packageHeight');
  if (!sku.packageDepth) gaps.push('packageDepth');
  return { ready: gaps.length === 0, gaps };
}

export interface SkuPayload extends Record<string, unknown> {
  notes: string[];
}

export function buildSkuPayload(sku: SkuSource, qianyiCode: string): SkuPayload {
  const notes: string[] = [];
  const netWeight = sku.productWeight ?? sku.packageWeight ?? 0;
  if (!sku.productWeight) {
    notes.push('netWeight defaults to package weight, confirm manually');
  }
  return {
    sku: qianyiCode,
    title: sku.product.name.slice(0, 255),
    type: 'SINGLE',
    weight: sku.packageWeight ?? 0,
    netWeight,
    weightUnit: 'KG',
    length: sku.packageWidth ?? 0,
    width: sku.packageDepth ?? 0,
    height: sku.packageHeight ?? 0,
    dimensionUnit: 'cm',
    enable: 1,
    // 90 days is the documented default; furniture is not perishable.
    shelfLife: 90,
    picUrl: sku.images[0]?.url?.slice(0, 255),
    description: sku.product.description?.slice(0, 2048),
    notes,
  };
}

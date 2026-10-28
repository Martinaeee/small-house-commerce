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

/**
 * 千易 `shelfLife` is in days and is required. Furniture has no expiry, so we
 * send a horizon no warehouse will ever reach; 千易 must confirm the value is
 * acceptable (open item in the go-live runbook).
 */
const SHELF_LIFE_DAYS = 36500;

export function skuReadiness(sku: SkuSource): SkuReadiness {
  const gaps: string[] = [];
  if (!sku.packageWeight) gaps.push('packageWeight');
  // Net weight is a required Qianyi field and comes from the product record.
  // Falling back to the gross weight would ship a number we know is wrong, so
  // a SKU without it stays out of the creation list instead.
  if (!sku.productWeight) gaps.push('productWeight');
  if (!sku.packageWidth) gaps.push('packageWidth');
  if (!sku.packageHeight) gaps.push('packageHeight');
  if (!sku.packageDepth) gaps.push('packageDepth');
  return { ready: gaps.length === 0, gaps };
}

export interface SkuPayload extends Record<string, unknown> {
  notes: string[];
}

export function buildSkuPayload(sku: SkuSource, qianyiCode: string): SkuPayload {
  return {
    sku: qianyiCode,
    title: sku.product.name.slice(0, 255),
    type: 'SINGLE',
    weight: sku.packageWeight ?? 0,
    // Only reachable when `skuReadiness` said the row is ready.
    netWeight: sku.productWeight ?? 0,
    weightUnit: 'KG',
    length: sku.packageWidth ?? 0,
    width: sku.packageDepth ?? 0,
    height: sku.packageHeight ?? 0,
    dimensionUnit: 'cm',
    enable: 1,
    // 千易 requires a shelf life; furniture does not expire. This is an open
    // question for 千易 (see the go-live runbook) and is shown in the preview
    // list so the value is never a surprise.
    shelfLife: SHELF_LIFE_DAYS,
    picUrl: sku.images[0]?.url?.slice(0, 255),
    description: sku.product.description?.slice(0, 2048),
    notes: [`shelfLife sent as ${SHELF_LIFE_DAYS} days (furniture, no expiry)`],
  };
}

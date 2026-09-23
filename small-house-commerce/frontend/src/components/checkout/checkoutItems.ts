import type { CartItem, Product } from "@/lib/api";
import { comparePositionThenId } from "@/lib/product-selection";

/** One structured display pair on a checkout line ("Color" → "Red"). */
export interface CheckoutLineOption {
  label: string;
  value: string;
}

/**
 * The line's effective thumbnail (IMAGE or VIDEO); null renders the
 * placeholder. Cart lines carry the backend-enriched summary thumbnail;
 * the Buy Now line resolves from the product payload's effective cover.
 */
export interface CheckoutLineThumbnail {
  url: string;
  type: "IMAGE" | "VIDEO";
  altText: string | null;
}

export interface CheckoutLine {
  key: string;
  slug: string;
  name: string;
  /** Legacy variant text — the display fallback when `options` is empty. */
  variant: string;
  /** Structured option pairs in option-position order; empty for legacy lines. */
  options: CheckoutLineOption[];
  thumbnail: CheckoutLineThumbnail | null;
  quantity: number;
  unitPrice: number | null;
  compareAtPrice: number | null;
}

/** Cart path: pairs from the enriched summary's optionValues, already in the backend's canonical order. */
export function cartLineOptions(item: CartItem): CheckoutLineOption[] {
  return item.optionValues.map((value) => ({
    label: value.optionName,
    value: value.label,
  }));
}

/**
 * Buy Now path: pairs resolved from the product's option graph for the
 * requested SKU, ordered by option position. Empty when the SKU matches no
 * variant or the product has no typed options — the line then falls back to
 * its variant text, exactly like a legacy cart row.
 */
export function buyNowLineOptions(
  product: Product,
  skuId: string,
): CheckoutLineOption[] {
  const variant = product.variants.find((v) => v.sku?.id === skuId);
  if (!variant) return [];
  const pairs: CheckoutLineOption[] = [];
  for (const option of [...product.options].sort(comparePositionThenId)) {
    const value = option.values.find((candidate) =>
      variant.optionValueIds.includes(candidate.id),
    );
    if (value) pairs.push({ label: option.name, value: value.label });
  }
  return pairs;
}

/**
 * Buy Now thumbnail from the product payload's effective cover (the same
 * source product cards use) — no extra fetch; the cart path instead carries
 * the backend-enriched per-line thumbnail.
 */
export function buyNowThumbnail(product: Product): CheckoutLineThumbnail | null {
  const cover = product.effectiveCoverMedia;
  return cover
    ? { url: cover.url, type: cover.type, altText: cover.altText }
    : null;
}

export function clampQty(qty?: string): number {
  return Math.min(99, Math.max(1, Number(qty) || 1));
}

export function parseItemsParam(itemsParam?: string): string[] {
  return (itemsParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface CheckoutTotals {
  subtotal: number;
  /** Sum of compareAtPrice×qty where compareAtPrice actually exceeds unitPrice. */
  compareAtTotal: number;
  /** compareAtTotal − subtotal (display-only "you save", never deducted). */
  savings: number;
  discount: 0;
  total: number;
}

export function totalsFor(lines: {
  unitPrice: number | null;
  compareAtPrice?: number | null;
  quantity: number;
}[]): CheckoutTotals {
  // Selling-price subtotal: compareAtPrice is only a strikethrough reference,
  // not a discount deducted again at checkout.
  let subtotal = 0;
  let compareAtTotal = 0;
  for (const line of lines) {
    if (line.unitPrice === null) continue;
    subtotal += line.unitPrice * line.quantity;
    if (
      line.compareAtPrice !== null &&
      line.compareAtPrice !== undefined &&
      line.compareAtPrice > line.unitPrice
    ) {
      compareAtTotal += line.compareAtPrice * line.quantity;
    }
  }
  const savings = Math.max(0, compareAtTotal - subtotal);
  return { subtotal, compareAtTotal, savings, discount: 0, total: subtotal };
}

/**
 * Builds the checkout query string (leading "?" included, "" when empty).
 * Key names match checkout/page.tsx searchParams: a cart selection wins via
 * ?items=; otherwise Buy Now uses ?skuId=&qty=&slug=.
 */
export function checkoutQueryString({
  skuId,
  qty,
  itemsParam,
  slug,
}: {
  skuId?: string;
  qty?: string;
  itemsParam?: string;
  slug?: string;
}): string {
  if (itemsParam) return `?items=${itemsParam}`;
  if (skuId) {
    const params = [`skuId=${skuId}`];
    if (qty && qty !== "1") params.push(`qty=${qty}`);
    if (slug) params.push(`slug=${slug}`);
    return `?${params.join("&")}`;
  }
  return "";
}

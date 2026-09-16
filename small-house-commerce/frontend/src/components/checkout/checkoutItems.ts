export interface CheckoutLine {
  key: string;
  slug: string;
  name: string;
  variant: string;
  quantity: number;
  unitPrice: number | null;
  compareAtPrice: number | null;
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

export function totalsFor(lines: { unitPrice: number | null; quantity: number }[]): {
  subtotal: number;
  discount: 0;
  total: number;
} {
  // Selling-price subtotal: compareAtPrice is only a strikethrough reference,
  // not a discount deducted again at checkout.
  let subtotal = 0;
  for (const line of lines) {
    if (line.unitPrice === null) continue;
    subtotal += line.unitPrice * line.quantity;
  }
  return { subtotal, discount: 0, total: subtotal };
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

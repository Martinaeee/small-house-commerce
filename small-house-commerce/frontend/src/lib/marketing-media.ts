import type { Product } from "./api";
import type { LandingMedia } from "./marketing-content";

type LiveMediaProduct = Pick<Product, "variants" | "options">;

function safeMediaUrl(value: string): boolean {
  if (Array.from(value).some((char) => char === "\\" || char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return value.length > 1;
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}

export function selectLandingMedia(
  media: readonly LandingMedia[],
  product: LiveMediaProduct | null,
  selectedValueIds: Readonly<Record<string, string>>,
  variantId: string | null,
) {
  const variants = product?.variants.filter((variant) => variant.sku?.status === "ACTIVE" && variant.sku.price !== null) ?? [];
  const variantIds = new Set(variants.map((variant) => variant.id));
  const valueIds = new Set(variants.flatMap((variant) => variant.optionValueIds));
  let blockedUrlCount = 0;
  let staleBindingCount = 0;
  const valid = media.filter((item) => {
    if (!safeMediaUrl(item.url)) { blockedUrlCount++; return false; }
    if ((item.variantId && item.optionValueId) ||
        (product && ((item.variantId && !variantIds.has(item.variantId)) || (item.optionValueId && !valueIds.has(item.optionValueId))))) {
      staleBindingCount++; return false;
    }
    return true;
  });
  let selected: readonly LandingMedia[] = [];
  if (product && variantId) selected = valid.filter((item) => item.variantId === variantId);
  if (selected.length === 0 && product) {
    for (const option of [...product.options].sort((a, b) => a.position - b.position)) {
      if (!option.isMediaDriver) continue;
      const valueId = selectedValueIds[option.id];
      if (!valueId) continue;
      selected = valid.filter((item) => item.optionValueId === valueId);
      if (selected.length) break;
    }
  }
  if (selected.length === 0) selected = valid.filter((item) => !item.variantId && !item.optionValueId);
  return { media: selected, blockedUrlCount, staleBindingCount };
}

import type { ProductMedia } from "@/lib/api";

/**
 * First image a product can use as a cover. Cover surfaces render through
 * plain <img> (and the Next image optimizer), so a VIDEO — even when it opens
 * the gallery or is the API's effective cover — must never win. Falls back to
 * the first gallery image, or null when the product carries only videos.
 */
export function productCoverMedia(
  product:
    | { effectiveCoverMedia: ProductMedia | null; images?: ProductMedia[] }
    | null
    | undefined,
): ProductMedia | null {
  if (!product) return null;
  const candidates = [product.effectiveCoverMedia, ...(product.images ?? [])];
  return (
    candidates.find(
      (media) => media?.type === "IMAGE" && media.url.trim() !== "",
    ) ?? null
  );
}

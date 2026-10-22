import { serverApiUrl, type Paged, type Product } from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";
import { selectableAvailableInventory } from "@/lib/pdp-products";

/**
 * The products offered under the order-tracking page.
 *
 * These are the store's own published products (the storefront list, newest
 * first) - NOT a personalised pick: nothing about the shopper is known on
 * this page. A product that cannot be bought right now is left out, the same
 * rule the PDP's related row follows (lib/pdp-products).
 */

/** How many products the row shows. */
export const TRACK_RECOMMENDATION_LIMIT = 4;

/**
 * The page asks for more than it shows, so a few sold-out products in the
 * list do not leave the row half empty.
 */
const TRACK_RECOMMENDATION_POOL = 8;

/** Keeps the products a shopper can actually buy, up to the limit. */
export function selectTrackRecommendations(
  products: readonly Product[],
  limit: number = TRACK_RECOMMENDATION_LIMIT,
): Product[] {
  return products
    .filter((product) => selectableAvailableInventory(product) > 0)
    .slice(0, Math.max(0, Math.trunc(limit)));
}

/**
 * The product row under the track-order page. Empty when the storefront
 * cannot be reached - the lookup page itself never fails because of it.
 */
export async function fetchTrackRecommendations(
  limit: number = TRACK_RECOMMENDATION_LIMIT,
): Promise<Product[]> {
  try {
    const res = await fetch(
      serverApiUrl(
        `/api/v1/storefront/products?pageSize=${TRACK_RECOMMENDATION_POOL}`,
      ),
      { next: { revalidate: 300, tags: STOREFRONT_TAGS } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Paged<Product>;
    return selectTrackRecommendations(data.items ?? [], limit);
  } catch {
    return [];
  }
}

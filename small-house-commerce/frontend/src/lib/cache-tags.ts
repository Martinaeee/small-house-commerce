/**
 * Next Data Cache tags for storefront server fetches (`next.tags`).
 *
 * After an admin write (review/product/LP/category change), the backend
 * POSTs the affected tag to /api/internal/revalidate so cached storefront
 * pages regenerate immediately instead of waiting for the time-based
 * revalidate window. Keep these strings in sync with
 * backend/src/common/revalidation.ts (CACHE_TAGS).
 */
export const CACHE_TAGS = {
  // Every public catalog surface: PDPs, /lp pages, home, collections,
  // category/search lists and the shared nav. A single tag keeps the
  // invalidation contract trivially correct at this store's write volume.
  STOREFRONT: "storefront",
} as const;

export const STOREFRONT_TAGS = [CACHE_TAGS.STOREFRONT];

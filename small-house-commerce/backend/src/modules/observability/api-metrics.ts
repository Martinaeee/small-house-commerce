/**
 * P3 route classification and response budgets. Only storefront API traffic is
 * sampled; admin, external-ingest and health routes are intentionally skipped
 * so internal operations never distort customer-facing latency.
 */
export type RouteGroup =
  | 'orders'
  | 'product'
  | 'catalog'
  | 'cart'
  | 'content'
  | 'newsletter'
  | 'analytics'
  | 'other';

export const ROUTE_BUDGET_MS: Record<RouteGroup, number> = {
  orders: 2000,
  product: 2000,
  catalog: 1500,
  cart: 1000,
  content: 1500,
  newsletter: 1000,
  analytics: 500,
  other: 1500,
};

const RULES: Array<[RegExp, RouteGroup]> = [
  [/^\/storefront\/orders(\/|$)/, 'orders'],
  [/^\/storefront\/products(\/|$)/, 'product'],
  [/^\/storefront\/collections(\/|$)|\/storefront\/categories(\/|$)/, 'catalog'],
  [/^\/storefront\/cart(\/|$)|\/storefront\/checkout(\/|$)/, 'cart'],
  [/^\/storefront\/newsletter(\/|$)|\/storefront\/back-in-stock(\/|$)/, 'newsletter'],
  [/^\/storefront\/events(\/|$)/, 'analytics'],
  [
    /^\/storefront\/(homepage|announcement|settings|psgc|short-links|lp|marketing-touch|meta-events|customers|delivery-windows|shell)(\/|$)/,
    'content',
  ],
  [/^\/storefront(\/)?$/, 'content'],
];

/** Strip the API prefix and query string, then classify; null means skip. */
export function routeGroupOf(rawPath: string): RouteGroup | null {
  const path = (rawPath.split('?')[0] ?? '').replace(/^\/api\/v1/, '');
  if (!path.startsWith('/storefront')) return null;
  for (const [pattern, group] of RULES) {
    if (pattern.test(path)) return group;
  }
  return 'other';
}

/** Path only: no query string, no headers, no body. */
export function sanitizedPath(rawPath: string): string {
  const path = (rawPath.split('?')[0] ?? '').slice(0, 512);
  return path.length > 0 ? path : '/';
}

export function isServerError(status: number): boolean {
  return status >= 500;
}

export function exceedsBudget(durationMs: number, group: RouteGroup): boolean {
  return durationMs > ROUTE_BUDGET_MS[group];
}

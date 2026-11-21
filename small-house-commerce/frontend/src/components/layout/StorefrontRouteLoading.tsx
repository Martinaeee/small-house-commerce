/**
 * Shared Suspense fallback for in-store client navigation.
 *
 * The layout groups only the routes that opt in: a route with its own
 * `loading.tsx` renders this while its RSC payload arrives. Product pages
 * deliberately do not opt in — a route-level fallback there is re-activated
 * during hydration after the content has painted and costs ~1.8 CLS, so those
 * routes keep the previous page visible until the product resolves.
 *
 * This used to render the brand wordmark as a pulsing logo. On a phone that
 * read as a "loading logo" customers waited on, and it also paid for a
 * brand-asset image request mid-navigation. It is now a plain thin bar: the
 * lightest possible signal that the route is changing.
 *
 * `.boot-nav-loader` delays fade-in by 200ms, so prefetched instant
 * navigations never flash a loader.
 */
export default function StorefrontRouteLoading() {
  return (
    <div
      className="boot-nav-loader flex min-h-[60vh] items-start justify-center pt-24"
      role="status"
      aria-label="Loading"
    >
      <span className="boot-nav-loader-bar" aria-hidden />
    </div>
  );
}

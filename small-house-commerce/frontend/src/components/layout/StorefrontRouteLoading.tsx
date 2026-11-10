import { BrandWordmark } from "@/components/layout/BrandWordmark";

/**
 * Shared Suspense fallback for in-store client navigation.
 *
 * The layout groups only the routes that opt in: a route with its own
 * `loading.tsx` renders this lockup while its RSC payload arrives. Product
 * pages deliberately do not opt in — a route-level fallback there is re-activated
 * during hydration after the content has painted and costs ~1.8 CLS, so those
 * routes keep the previous page visible until the product resolves.
 *
 * `.boot-nav-loader` delays fade-in by 200ms, so prefetched instant
 * navigations never flash a loader.
 */
export default function StorefrontRouteLoading() {
  return (
    <div
      className="boot-nav-loader flex min-h-[60vh] items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <span className="boot-splash-pulse inline-flex">
        <BrandWordmark className="text-3xl" />
      </span>
    </div>
  );
}

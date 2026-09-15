import { BrandWordmark } from "@/components/layout/BrandWordmark";

/**
 * Suspense fallback for in-store client navigation. The header/footer stay
 * interactive; only the page area shows the breathing lockup.
 *
 * `.boot-nav-loader` delays fade-in by 200ms, so prefetched instant
 * navigations never flash a loader.
 */
export default function StorefrontLoading() {
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

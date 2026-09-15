"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api, type Collection, type Product } from "@/lib/api";
import {
  BESTSELLER_BADGE,
  NEW_BADGE,
  buildBadgeMap,
  visibleBadges,
  type CardBadge,
} from "@/lib/plpBadges";
import { buildPlpQuery, parsePlpState } from "@/lib/plpUrl";
import {
  DEFAULT_FILTERS,
  PLP_MAX_PRODUCTS,
  PLP_PAGE_SIZE,
  SORT_OPTIONS,
  activeFilterCount,
  filterProducts,
  sortProducts,
  type PlpFilters,
  type SortKey,
} from "@/lib/plp";
import { PlpProductCard } from "@/components/product/PlpProductCard";
import { CategoryFilterSidebar } from "./CategoryFilterSidebar";

/**
 * Castlery-style category PLP. The frozen product API has no sort parameter
 * and only room/solution/price server filters, so after the SSR'd first page
 * this pulls the rest of the category into the client (capped) and does all
 * sorting/filtering instantly without navigation. Bestseller/New badges come
 * from real collection memberships.
 */
interface CategoryPlpClientProps {
  categoryId: string;
  initialProducts: Product[];
  initialTotal: number;
  initialLoadFailed: boolean;
}

async function fetchCollectionSlugs(slug: string): Promise<Set<string>> {
  const slugs = new Set<string>();
  try {
    for (let page = 1; page <= 3; page += 1) {
      const data = await api.getCollectionProducts(slug, page);
      data.items.forEach((p) => slugs.add(p.slug));
      if (data.items.length === 0 || slugs.size >= data.total) break;
    }
  } catch {
    /* a missing/empty collection just means no badge */
  }
  return slugs;
}

function CategoryPlpClientInner({
  categoryId,
  initialProducts,
  initialTotal,
  initialLoadFailed,
}: CategoryPlpClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // Synced from the server prop: the server remounts this island (key flip)
  // after a successful router.refresh() retry, so no setter is needed.
  const [loadFailed] = useState(initialLoadFailed);
  const [allProducts, setAllProducts] = useState<Product[]>(initialProducts);
  // A failed first page renders the retry card with no spinner: no requests
  // follow (see effect guard), so loading starts false on that mount.
  const [loading, setLoading] = useState(
    initialTotal > initialProducts.length && !initialLoadFailed,
  );
  const [badgeMap, setBadgeMap] = useState<Map<string, CardBadge[]>>(new Map());
  const [sort, setSort] = useState<SortKey>(() => parsePlpState(searchParams).sort);
  const [filters, setFilters] = useState<PlpFilters>(
    () => parsePlpState(searchParams).filters,
  );
  // Back/forward -> URL is the source of truth. Reconciled during render
  // (same pattern as the admin orders/products lists) instead of an effect so
  // external navigation updates state without a cascading post-paint render.
  const [syncedParams, setSyncedParams] = useState(searchParams);
  if (searchParams !== syncedParams) {
    setSyncedParams(searchParams);
    const next = parsePlpState(searchParams);
    setSort(next.sort);
    setFilters(next.filters);
  }
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Load the remaining pages (page 1 was server-rendered) plus the badge
  // collections. State is only set after the awaits.
  useEffect(() => {
    let alive = true;
    // A failed first page already shows the retry card (loading seeded false
    // above). Don't fire the remaining-page / collection / badge requests
    // behind it; the post-retry key-flip remounts with
    // initialLoadFailed=false and loads everything.
    if (initialLoadFailed) return;
    void (async () => {
      const pageCount = Math.min(
        5,
        Math.max(1, Math.ceil(Math.min(initialTotal, PLP_MAX_PRODUCTS) / PLP_PAGE_SIZE)),
      );
      const pageRequests: Promise<Product[]>[] = [];
      for (let p = 2; p <= pageCount; p += 1) {
        pageRequests.push(
          api
            .getProducts({ categoryId, page: p, pageSize: PLP_PAGE_SIZE })
            .then((data) => data.items)
            .catch(() => []),
        );
      }

      // Identity collections are fetched by fixed slug unconditionally — the
      // old behaviour did not depend on the list endpoint succeeding (or on
      // the collection being inside its first page).
      const badgeCollections: { slug: string; badge: CardBadge }[] = [
        { slug: "best-sellers", badge: BESTSELLER_BADGE },
        { slug: "new-arrivals", badge: NEW_BADGE },
      ];
      // Up to four promo collections carry an admin badgeLabel (spec §4.3).
      // The field does not exist on the phase-1 backend, so until phase 2
      // this list contributes nothing.
      let collections: Collection[] = [];
      try {
        collections = (await api.getCollections()).items;
      } catch {
        collections = [];
      }
      // Spec §4.3: badgeLabel promos, first 4 by sortOrder (sort client-side so
      // the rule holds regardless of the list endpoint's ordering).
      const promos = collections
        .filter(
          (collection) =>
            (collection.badgeLabel ?? "").trim() !== "" &&
            collection.slug !== "best-sellers" &&
            collection.slug !== "new-arrivals",
        )
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .slice(0, 4);
      for (const collection of promos) {
        badgeCollections.push({
          slug: collection.slug,
          badge: { kind: "promo", label: (collection.badgeLabel ?? "").trim() },
        });
      }

      const [rest, memberSets] = await Promise.all([
        Promise.all(pageRequests).then((pages) => pages.flat()),
        Promise.all(
          badgeCollections.map(async (source) => ({
            source,
            slugs: await fetchCollectionSlugs(source.slug),
          })),
        ),
      ]);
      if (!alive) return;
      if (rest.length > 0) {
        setAllProducts((current) => {
          const seen = new Set(current.map((p) => p.id));
          return [...current, ...rest.filter((p) => !seen.has(p.id))];
        });
      }
      const entries = memberSets.flatMap(({ source, slugs }) =>
        [...slugs].map((slug) => ({ slug, badge: source.badge })),
      );
      setBadgeMap(buildBadgeMap(entries));
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [categoryId, initialTotal, initialProducts.length, initialLoadFailed]);

  // Lock body scroll while the mobile filter drawer is open + Escape closes.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  // State -> URL via replace (history stays clean for the back button).
  useEffect(() => {
    const qs = buildPlpQuery(sort, filters);
    if (qs !== searchParams.toString()) {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, filters]);

  // The recommended sort surfaces best-sellers first; derive that slug set
  // from the unified badge map instead of keeping separate state.
  const bestsellerSlugs = useMemo(() => {
    const slugs = new Set<string>();
    for (const [slug, badges] of badgeMap) {
      if (badges.some((badge) => badge.kind === "bestseller")) slugs.add(slug);
    }
    return slugs;
  }, [badgeMap]);

  const visibleProducts = useMemo(() => {
    const filtered = filterProducts(allProducts, filters);
    return sortProducts(filtered, sort, bestsellerSlugs);
  }, [allProducts, filters, sort, bestsellerSlugs]);

  const filterCount = activeFilterCount(filters);

  // First-page fetch failure (server passed initialLoadFailed). Distinct from
  // a genuinely empty category, which keeps the normal empty state below.
  if (loadFailed) {
    return (
      <div className="mt-6 rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-ink-secondary">We couldn&apos;t load these products.</p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-3 rounded-lg bg-cta px-5 py-2 text-sm font-medium text-white hover:bg-cta-hover"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink">Filters</h2>
          <CategoryFilterSidebar filters={filters} onChange={setFilters} />
        </div>
      </aside>

      <section>
        {/* Toolbar */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-ink lg:hidden"
              aria-haspopup="dialog"
            >
              Filter{filterCount > 0 ? ` (${filterCount})` : ""}
            </button>
            <p className="text-sm text-ink-muted">
              {visibleProducts.length} {visibleProducts.length === 1 ? "product" : "products"}
              {loading && <span className="ml-2 text-xs">loading more…</span>}
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <span className="hidden sm:inline">Sort by</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              data-testid="plp-sort"
              className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-ink focus:border-primary focus:outline-none"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {visibleProducts.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-ink-secondary">
              {filterCount > 0 ? "No products match these filters." : "No products in this category yet."}
            </p>
            {filterCount > 0 && (
              <button
                type="button"
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="mt-3 text-sm text-cta hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
            {visibleProducts.map((product) => (
              <PlpProductCard
                key={product.id}
                product={product}
                badges={visibleBadges(badgeMap, product.slug)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Mobile filter drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <button
            type="button"
            aria-label="Close filters"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute left-0 top-0 flex h-full w-80 max-w-[85%] flex-col bg-card">
            <div className="flex items-center justify-between border-b border-border p-4">
              <h2 className="text-base font-semibold text-ink">Filters</h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close filters"
                className="text-ink-secondary hover:text-ink"
              >
                <svg viewBox="0 0 16 16" className="h-5 w-5" fill="none" aria-hidden="true">
                  <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <CategoryFilterSidebar filters={filters} onChange={setFilters} />
            </div>
            <div className="border-t border-border p-4">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="w-full rounded-lg bg-cta py-2.5 text-sm font-medium text-white hover:bg-cta-hover"
              >
                Show {visibleProducts.length} products
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function CategoryPlpClient(props: CategoryPlpClientProps) {
  return (
    <Suspense
      fallback={
        <div className="mt-6 rounded-lg border border-border bg-card p-8 text-center text-sm text-ink-muted">
          Loading products…
        </div>
      }
    >
      <CategoryPlpClientInner {...props} />
    </Suspense>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { CollectionFilters } from "@/components/collection/CollectionFilters";
import { ProductCard } from "@/components/product/ProductCard";
import { serverApiUrl, type Category, type Paged, type Product } from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";

export const revalidate = 120;

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true },
};

interface SearchParams {
  q?: string;
  page?: string;
  room?: string;
  solution?: string;
  minPrice?: string;
  maxPrice?: string;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  let products: Paged<Product> | null = null;
  let roots: Category[] = [];

  if (q) {
    // `q` is the page param; the storefront API parameter is `search`.
    const params = new URLSearchParams({
      search: q,
      page: String(page),
      pageSize: "24",
    });
    if (sp.room) params.set("room", sp.room);
    if (sp.solution) params.set("solution", sp.solution);
    if (sp.minPrice) params.set("minPrice", sp.minPrice);
    if (sp.maxPrice) params.set("maxPrice", sp.maxPrice);

    try {
      const [productsRes, categoriesRes] = await Promise.all([
        fetch(serverApiUrl(`/api/v1/storefront/products?${params.toString()}`), {
          next: { revalidate: 120, tags: STOREFRONT_TAGS },
        }),
        fetch(serverApiUrl("/api/v1/storefront/categories"), {
          next: { revalidate: 300, tags: STOREFRONT_TAGS },
        }),
      ]);
      // Non-OK HTTP is handled inline (falls through to the empty state below);
      // the try/catch covers network-level rejection (backend down).
      if (productsRes.ok) products = (await productsRes.json()) as Paged<Product>;
      if (categoriesRes.ok) roots = (await categoriesRes.json()) as Category[];
    } catch {
      // Same failure shape as the collection page: degrade to the real empty
      // state instead of the default error page.
      products = null;
      roots = [];
    }
  }

  const items = products?.items ?? [];
  const totalPages = products ? Math.max(1, Math.ceil(products.total / products.pageSize)) : 1;
  const activeFilterCount =
    (sp.room ? 1 : 0) +
    (sp.solution ? 1 : 0) +
    (sp.minPrice !== undefined ? 1 : 0) +
    (sp.maxPrice !== undefined ? 1 : 0);

  // Pagination keeps the query and every active filter.
  const pageHref = (target: number) => {
    const p = new URLSearchParams({ q, page: String(target) });
    if (sp.room) p.set("room", sp.room);
    if (sp.solution) p.set("solution", sp.solution);
    if (sp.minPrice) p.set("minPrice", sp.minPrice);
    if (sp.maxPrice) p.set("maxPrice", sp.maxPrice);
    return `/search?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      {!q ? (
        <div className="rounded-lg border border-border bg-card p-10 text-center">
          <h1 className="text-2xl font-semibold text-ink">Search</h1>
          <p className="mt-2 text-ink-secondary">
            Start by typing what you’re looking for in the search bar.
          </p>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">
            Search results for “{q}”
            {products && (
              <span className="ml-2 text-base font-normal text-ink-muted">({products.total})</span>
            )}
          </h1>

          <div className="mt-6 rounded-lg border border-border bg-card p-4">
            <CollectionFilters
              basePath="/search"
              preserve={{ q }}
              active={{ room: sp.room, solution: sp.solution, minPrice: sp.minPrice, maxPrice: sp.maxPrice }}
            />
          </div>

          {items.length === 0 ? (
            <div className="mt-8 rounded-lg border border-border bg-card p-8 text-center">
              <p className="text-ink-secondary">
                {activeFilterCount > 0
                  ? "No products match these filters."
                  : `No products match “${q}”. Check the spelling or browse a category.`}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {roots.map((root) => (
                  <Link
                    key={root.id}
                    href={`/categories/${root.slug}`}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-ink-secondary hover:border-primary hover:text-cta"
                  >
                    {root.name}
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {items.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
              <nav aria-label="Search pages" className="mt-8 flex items-center justify-center gap-4">
                {page > 1 && (
                  <Link
                    href={pageHref(page - 1)}
                    className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-ink hover:border-primary"
                  >
                    Previous
                  </Link>
                )}
                <span className="text-sm text-ink-muted">
                  Page {page} of {totalPages}
                </span>
                {page < totalPages && (
                  <Link
                    href={pageHref(page + 1)}
                    className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-ink hover:border-primary"
                  >
                    Load more
                  </Link>
                )}
              </nav>
            </>
          )}
        </>
      )}
    </div>
  );
}

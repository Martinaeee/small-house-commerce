import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CollectionFilters } from "@/components/collection/CollectionFilters";
import { HeroBanner } from "@/components/product/HeroBanner";
import { ProductCard } from "@/components/product/ProductCard";
import { ButtonLink } from "@/components/ui/Button";
import { serverApiUrl, type Collection, type Paged, type Product } from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";

export const revalidate = 120;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const collection = await fetchCollection((await params).slug);
  return {
    title: collection?.seoTitle ?? collection?.name,
    description: collection?.seoDescription ?? collection?.description ?? undefined,
  };
}

async function fetchCollection(slug: string) {
  try {
    const res = await fetch(serverApiUrl(`/api/v1/storefront/collections/${slug}`), {
      next: { revalidate, tags: STOREFRONT_TAGS },
    });
    if (!res.ok) return null;
    return (await res.json()) as Collection & { sections: unknown[] };
  } catch {
    return null;
  }
}

async function fetchProducts(
  slug: string,
  page: number,
  filters: { room?: string; solution?: string; minPrice?: number; maxPrice?: number },
): Promise<Paged<Product> | null> {
  try {
    const q = new URLSearchParams({ page: String(page), pageSize: "24" });
    if (filters.room) q.set("room", filters.room);
    if (filters.solution) q.set("solution", filters.solution);
    if (filters.minPrice !== undefined) q.set("minPrice", String(filters.minPrice));
    if (filters.maxPrice !== undefined) q.set("maxPrice", String(filters.maxPrice));
    const res = await fetch(
      serverApiUrl(`/api/v1/storefront/collections/${slug}/products?${q.toString()}`),
      { next: { revalidate, tags: STOREFRONT_TAGS } },
    );
    if (!res.ok) return null;
    return (await res.json()) as Paged<Product>;
  } catch {
    return null;
  }
}

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string; room?: string; solution?: string; minPrice?: string; maxPrice?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const filters = {
    room: sp.room,
    solution: sp.solution,
    minPrice: sp.minPrice !== undefined ? Number(sp.minPrice) : undefined,
    maxPrice: sp.maxPrice !== undefined ? Number(sp.maxPrice) : undefined,
  };
  const collection = await fetchCollection(slug);
  if (!collection) notFound();

  const products = await fetchProducts(slug, page, filters);
  const items = products?.items ?? [];
  const totalPages = products ? Math.max(1, Math.ceil(products.total / products.pageSize)) : 1;

  const activeFilterCount =
    (filters.room ? 1 : 0) + (filters.solution ? 1 : 0) + (filters.minPrice !== undefined ? 1 : 0);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      {/* §7 Collection Hero: admin-configurable background and centered title
          (HeroStyle), with the description + CTA in the block beneath. */}
      <HeroBanner
        name={collection.name}
        style={collection.heroStyle}
        fallbackImage={collection.heroImage}
      />
      <section className="mt-3 flex flex-col items-center gap-4 rounded-lg border border-border bg-card px-4 py-8 text-center sm:px-8">
        {collection.description && (
          <p className="max-w-2xl text-base text-ink-secondary">{collection.description}</p>
        )}
        <ButtonLink href="#products" variant="primary" size="lg">
          Shop this collection
        </ButtonLink>
      </section>

      {/* §12 Filters */}
      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <CollectionFilters
          basePath={`/collections/${slug}`}
          active={{
            room: sp.room,
            solution: sp.solution,
            minPrice: sp.minPrice,
            maxPrice: sp.maxPrice,
          }}
        />
      </div>

      {/* §10 Product Grid: 2 cols mobile, 3-4 desktop */}
      <section id="products" className="mt-8 scroll-mt-20">
        <h2 className="mb-6 text-2xl font-semibold text-ink">
          {collection.name} Products
          {products && (
            <span className="ml-2 text-base font-normal text-ink-muted">
              ({products.total}
              {activeFilterCount > 0 ? " filtered" : ""})
            </span>
          )}
        </h2>

        {items.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-ink-secondary">No products match these filters.</p>
            {activeFilterCount > 0 && (
              <Link
                href={`/collections/${slug}`}
                className="mt-3 inline-block text-sm text-cta hover:underline"
              >
                Clear all filters
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {items.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>

            {/* Pagination */}
            <nav aria-label="Collection pages" className="mt-8 flex items-center justify-center gap-4">
              {page > 1 && (
                <Link
                  href={`/collections/${slug}?page=${page - 1}`}
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
                  href={`/collections/${slug}?page=${page + 1}`}
                  className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-ink hover:border-primary"
                >
                  Load more
                </Link>
              )}
            </nav>
          </>
        )}
      </section>
    </div>
  );
}

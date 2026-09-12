import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CollectionFilters } from "@/components/collection/CollectionFilters";
import { ProductCard } from "@/components/product/ProductCard";
import { findCategory } from "@/lib/nav";
import { serverApiUrl, type Category, type Paged, type Product } from "@/lib/api";

export const revalidate = 120;

interface ResolvedCategory {
  node: Category;
  parent: Category | null;
  roots: Category[];
}

async function resolveCategory(slug: string): Promise<ResolvedCategory | null> {
  try {
    const res = await fetch(serverApiUrl("/api/v1/storefront/categories"), {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const roots = (await res.json()) as Category[];
    const node = findCategory(roots, slug);
    if (!node) return null;
    const parent = roots.find((root) => root.children.some((leaf) => leaf.id === node.id)) ?? null;
    return { node, parent, roots };
  } catch {
    return null;
  }
}

async function fetchProducts(
  categoryId: string,
  page: number,
  filters: { room?: string; solution?: string; minPrice?: number; maxPrice?: number },
): Promise<Paged<Product> | null> {
  try {
    const q = new URLSearchParams({
      categoryId,
      page: String(page),
      pageSize: "24",
    });
    if (filters.room) q.set("room", filters.room);
    if (filters.solution) q.set("solution", filters.solution);
    if (filters.minPrice !== undefined) q.set("minPrice", String(filters.minPrice));
    if (filters.maxPrice !== undefined) q.set("maxPrice", String(filters.maxPrice));
    const res = await fetch(serverApiUrl(`/api/v1/storefront/products?${q.toString()}`), {
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as Paged<Product>;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const resolved = await resolveCategory((await params).slug);
  if (!resolved) return {};
  const { node } = resolved;
  const isRoot = node.children.length > 0;
  return {
    title: isRoot ? `Shop ${node.name}` : node.name,
    description: isRoot
      ? `Browse ${node.name} made for small homes in the Philippines. Cash on delivery, nationwide shipping.`
      : undefined,
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    page?: string;
    room?: string;
    solution?: string;
    minPrice?: string;
    maxPrice?: string;
  }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);

  const resolved = await resolveCategory(slug);
  if (!resolved) notFound();
  const { node, parent } = resolved;

  const filters = {
    room: sp.room,
    solution: sp.solution,
    minPrice: sp.minPrice !== undefined ? Number(sp.minPrice) : undefined,
    maxPrice: sp.maxPrice !== undefined ? Number(sp.maxPrice) : undefined,
  };

  // Backend expands the subtree: a root page lists products on every leaf.
  const products = await fetchProducts(node.id, page, filters);
  const items = products?.items ?? [];
  const totalPages = products ? Math.max(1, Math.ceil(products.total / products.pageSize)) : 1;
  const activeFilterCount =
    (filters.room ? 1 : 0) + (filters.solution ? 1 : 0) + (filters.minPrice !== undefined ? 1 : 0);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="text-xs text-ink-muted">
        <Link href="/" className="hover:text-cta">
          Home
        </Link>
        {parent && (
          <>
            {" › "}
            <Link href={`/categories/${parent.slug}`} className="hover:text-cta">
              {parent.name}
            </Link>
          </>
        )}
        {" › "}
        <span className="text-ink-secondary">{node.name}</span>
      </nav>

      {/* Header */}
      <section className="mt-4 flex flex-col gap-3">
        <h1 className="text-3xl font-semibold text-ink sm:text-4xl">{node.name}</h1>
        {node.children.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {node.children.map((leaf) => (
              <Link
                key={leaf.id}
                href={`/categories/${leaf.slug}`}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:border-primary hover:text-cta"
              >
                {leaf.name}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Filters */}
      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <CollectionFilters
          basePath={`/categories/${slug}`}
          active={{
            room: sp.room,
            solution: sp.solution,
            minPrice: sp.minPrice,
            maxPrice: sp.maxPrice,
          }}
        />
      </div>

      {/* Products */}
      <section className="mt-8">
        <h2 className="mb-6 text-2xl font-semibold text-ink">
          {node.name}
          {products && (
            <span className="ml-2 text-base font-normal text-ink-muted">
              ({products.total}
              {activeFilterCount > 0 ? " filtered" : ""})
            </span>
          )}
        </h2>

        {items.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-ink-secondary">
              {activeFilterCount > 0
                ? "No products match these filters."
                : "No products in this category yet."}
            </p>
            {activeFilterCount > 0 && (
              <Link
                href={`/categories/${slug}`}
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

            <nav aria-label="Category pages" className="mt-8 flex items-center justify-center gap-4">
              {page > 1 && (
                <Link
                  href={`/categories/${slug}?page=${page - 1}`}
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
                  href={`/categories/${slug}?page=${page + 1}`}
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

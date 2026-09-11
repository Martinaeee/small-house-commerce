import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductCard } from "@/components/product/ProductCard";
import { ButtonLink } from "@/components/ui/Button";
import { serverApiUrl, type Collection, type Paged, type Product } from "@/lib/api";

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
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as Collection & { sections: unknown[] };
  } catch {
    return null;
  }
}

async function fetchProducts(slug: string, page: number): Promise<Paged<Product> | null> {
  try {
    const res = await fetch(
      serverApiUrl(`/api/v1/storefront/collections/${slug}/products?page=${page}&pageSize=24`),
      { next: { revalidate } },
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
  searchParams: Promise<{ page?: string }>;
}) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const collection = await fetchCollection(slug);
  if (!collection) notFound();

  const products = await fetchProducts(slug, page);
  const items = products?.items ?? [];
  const totalPages = products ? Math.max(1, Math.ceil(products.total / products.pageSize)) : 1;

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      {/* §7 Collection Hero: image -> title -> description -> CTA */}
      <section className="flex flex-col items-center gap-4 rounded-lg border border-border bg-card px-4 py-10 text-center sm:px-8">
        <h1 className="text-3xl font-semibold text-ink sm:text-4xl">{collection.name}</h1>
        {collection.description && (
          <p className="max-w-2xl text-base text-ink-secondary">{collection.description}</p>
        )}
        <ButtonLink href="#products" variant="primary" size="lg">
          Shop this collection
        </ButtonLink>
      </section>

      {/* §10 Product Grid: 2 cols mobile, 3-4 desktop */}
      <section id="products" className="mt-10 scroll-mt-20">
        <h2 className="mb-6 text-2xl font-semibold text-ink">
          {collection.name} Products
          {products && <span className="ml-2 text-base font-normal text-ink-muted">({products.total})</span>}
        </h2>

        {items.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-8 text-center text-ink-secondary">
            No products in this collection yet.
          </p>
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

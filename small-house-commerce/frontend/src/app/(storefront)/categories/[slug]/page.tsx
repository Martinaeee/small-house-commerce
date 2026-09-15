import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryPlpClient } from "@/components/category/CategoryPlpClient";
import { buildCategoryJsonLd } from "@/lib/category-jsonld";
import { findCategory } from "@/lib/nav";
import { PLP_PAGE_SIZE } from "@/lib/plp";
import { serverApiUrl, type Category, type Paged, type Product } from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";

export const revalidate = 120;

interface ResolvedCategory {
  node: Category;
  parent: Category | null;
  roots: Category[];
}

async function resolveCategory(slug: string): Promise<ResolvedCategory | null> {
  try {
    const res = await fetch(serverApiUrl("/api/v1/storefront/categories"), {
      next: { revalidate: 300, tags: STOREFRONT_TAGS },
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

async function fetchFirstPage(categoryId: string): Promise<Paged<Product> | null> {
  try {
    const q = new URLSearchParams({
      categoryId,
      page: "1",
      pageSize: String(PLP_PAGE_SIZE),
    });
    const res = await fetch(serverApiUrl(`/api/v1/storefront/products?${q.toString()}`), {
      next: { revalidate, tags: STOREFRONT_TAGS },
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

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const resolved = await resolveCategory(slug);
  if (!resolved) notFound();
  const { node, parent } = resolved;

  // Backend expands the subtree: a root page lists products on every leaf.
  const products = await fetchFirstPage(node.id);
  const items = products?.items ?? [];
  const total = products?.total ?? 0;
  // null = the first-page request failed; an empty page is a genuinely empty
  // category and must keep the normal empty state.
  const initialLoadFailed = products === null;

  const jsonLdBlocks = buildCategoryJsonLd(node, parent, items);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
      {jsonLdBlocks.map((block, index) => (
        <script
          key={index}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(block).replace(/</g, "\\u003c"),
          }}
        />
      ))}
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

      {/* Sub-category sections */}
      {node.children.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
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

      {/* Category hero: category image with overlaid name; plain title until
          the admin uploads one. */}
      {node.imageUrl ? (
        <div className="relative mt-4 h-48 overflow-hidden rounded-lg sm:h-64">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={node.imageUrl}
            alt={node.name}
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-ink/60 via-ink/25 to-transparent" />
          <h1 className="absolute bottom-5 left-5 text-3xl font-semibold text-white drop-shadow-sm sm:text-4xl">
            {node.name}
          </h1>
        </div>
      ) : (
        <h1 className="mt-4 text-3xl font-semibold text-ink sm:text-4xl">{node.name}</h1>
      )}

      {/* router.refresh() preserves Client Component state, so the key flips
          failed -> ready after a successful retry to force a clean remount
          seeded from the new server-rendered first page. */}
      <CategoryPlpClient
        key={initialLoadFailed ? "load-failed" : "load-ok"}
        categoryId={node.id}
        initialProducts={items}
        initialTotal={total}
        initialLoadFailed={initialLoadFailed}
      />
    </div>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PdpClient } from "@/components/product/PdpClient";
import { ProductCard } from "@/components/product/ProductCard";
import { ReviewSection } from "@/components/product/ReviewSection";
import { TrustBar } from "@/components/ui/TrustBar";
import { serverApiUrl, type Category, type Paged, type Product } from "@/lib/api";

export const revalidate = 120;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProduct(slug);
  return { title: product?.name, description: product?.description ?? undefined };
}

async function fetchProduct(slug: string): Promise<Product | null> {
  try {
    const res = await fetch(serverApiUrl(`/api/v1/storefront/products/${slug}`), {
      next: { revalidate },
    });
    if (!res.ok) return null;
    return (await res.json()) as Product;
  } catch {
    return null;
  }
}

async function fetchCategoryName(categoryId: string): Promise<string | null> {
  try {
    const res = await fetch(serverApiUrl("/api/v1/storefront/categories"), {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const tree = (await res.json()) as Category[];
    const stack = [...tree];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.id === categoryId) return node.name;
      stack.push(...node.children);
    }
    return null;
  } catch {
    return null;
  }
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await fetchProduct(slug);
  if (!product) notFound();

  const [categoryName, relatedRes] = await Promise.all([
    fetchCategoryName(product.categoryId),
    fetch(
      serverApiUrl(`/api/v1/storefront/products?categoryId=${product.categoryId}&pageSize=5`),
      { next: { revalidate } },
    ).catch(() => null),
  ]);

  let related: Product[] = [];
  if (relatedRes?.ok) {
    try {
      related = ((await relatedRes.json()) as Paged<Product>).items.filter(
        (item) => item.id !== product.id,
      );
    } catch {
      related = [];
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 pb-24 sm:px-6 md:pb-8">
      <Suspense fallback={null}>
        <PdpClient product={product} categoryName={categoryName} />
      </Suspense>

      <section className="mt-12 flex flex-col gap-8">
        {product.description && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 text-2xl font-semibold text-ink">Description</h2>
            <p className="whitespace-pre-line text-base leading-relaxed text-ink-secondary">
              {product.description}
            </p>
          </div>
        )}
        <ReviewSection product={product} />
        <TrustBar />
      </section>

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-6 text-2xl font-semibold text-ink">You May Also Like</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

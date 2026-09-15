import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PdpView } from "@/components/product/PdpView";
import { deliveryWindows } from "@/lib/deliveryWindow";
import { absoluteUrl, buildProductJsonLd } from "@/lib/product-jsonld";
import { serverApiUrl, type Category, type Paged, type Product } from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";

export const revalidate = 120;

async function fetchProduct(slug: string): Promise<Product | null> {
  try {
    const res = await fetch(serverApiUrl(`/api/v1/storefront/products/${slug}`), {
      next: { revalidate, tags: STOREFRONT_TAGS },
    });
    if (!res.ok) return null;
    return (await res.json()) as Product;
  } catch {
    return null;
  }
}

export async function fetchCategoryInfo(
  categoryId: string,
): Promise<{ name: string; slug: string } | null> {
  try {
    const res = await fetch(serverApiUrl("/api/v1/storefront/categories"), {
      next: { revalidate: 300, tags: STOREFRONT_TAGS },
    });
    if (!res.ok) return null;
    const tree = (await res.json()) as Category[];
    const stack = [...tree];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.id === categoryId) return { name: node.name, slug: node.slug };
      stack.push(...node.children);
    }
    return null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProduct(slug);
  if (!product) return { title: "Product not found" };

  const description = product.description ?? undefined;
  const images = [...product.images]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image) => absoluteUrl(image.url));

  return {
    title: product.name,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      title: product.name,
      description,
      url: `/products/${product.slug}`,
      type: "website",
      images: images.length > 0 ? images : undefined,
    },
    twitter: {
      card: images.length > 0 ? "summary_large_image" : "summary",
      title: product.name,
      description,
      images: images.length > 0 ? images : undefined,
    },
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await fetchProduct(slug);
  if (!product) notFound();

  const [category, relatedRes] = await Promise.all([
    fetchCategoryInfo(product.categoryId),
    fetch(
      serverApiUrl(`/api/v1/storefront/products?categoryId=${product.categoryId}&pageSize=5`),
      { next: { revalidate, tags: STOREFRONT_TAGS } },
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
    <PdpView
      product={product}
      category={category}
      delivery={deliveryWindows()}
      related={related}
      jsonLd={buildProductJsonLd(product, category)}
    />
  );
}

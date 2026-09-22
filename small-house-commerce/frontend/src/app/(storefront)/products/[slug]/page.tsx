import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PdpView } from "@/components/product/PdpView";
import { deliveryWindows } from "@/lib/deliveryWindow";
import { absoluteUrl, buildProductJsonLd } from "@/lib/product-jsonld";
import { serverApiUrl, type Category, type Paged, type Product } from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";

export const revalidate = 120;

async function fetchProduct(
  slug: string,
  variantId?: string | null,
): Promise<Product | null> {
  try {
    const query = variantId
      ? `?variantId=${encodeURIComponent(variantId)}`
      : "";
    const res = await fetch(
      serverApiUrl(`/api/v1/storefront/products/${slug}${query}`),
      {
        next: { revalidate, tags: STOREFRONT_TAGS },
      },
    );
    if (!res.ok) return null;
    return (await res.json()) as Product;
  } catch {
    return null;
  }
}

/** One breadcrumb level; ordered root → leaf for display. */
export interface CategoryCrumb {
  name: string;
  slug: string;
}

/**
 * Walks the storefront category tree and returns the full root→leaf chain for
 * the product's category — the visible breadcrumb and the JSON-LD BreadcrumbList
 * are both generated from it, never hand-entered.
 */
export async function fetchCategoryInfo(
  categoryId: string,
): Promise<CategoryCrumb[] | null> {
  try {
    const res = await fetch(serverApiUrl("/api/v1/storefront/categories"), {
      next: { revalidate: 300, tags: STOREFRONT_TAGS },
    });
    if (!res.ok) return null;
    const tree = (await res.json()) as Category[];
    const path: CategoryCrumb[] = [];
    const dfs = (nodes: Category[]): CategoryCrumb[] | null => {
      for (const node of nodes) {
        path.push({ name: node.name, slug: node.slug });
        if (node.id === categoryId) return [...path];
        const found = dfs(node.children);
        if (found) return found;
        path.pop();
      }
      return null;
    };
    return dfs(tree);
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
  // OG/Twitter previews need poster images, not video URLs.
  const images = [...product.images]
    .filter((image) => image.type === "IMAGE")
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
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ variant?: string | string[] }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const initialVariantId =
    typeof query.variant === "string" ? query.variant : null;
  const baseProduct = await fetchProduct(slug);
  if (!baseProduct) notFound();
  const initialVariantIsSelectable = baseProduct.variants.some(
    (variant) =>
      variant.id === initialVariantId &&
      variant.sku?.status === "ACTIVE" &&
      variant.sku.price !== null,
  );
  const product = initialVariantIsSelectable
    ? ((await fetchProduct(slug, initialVariantId)) ?? baseProduct)
    : baseProduct;

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
      initialVariantId={initialVariantId}
    />
  );
}

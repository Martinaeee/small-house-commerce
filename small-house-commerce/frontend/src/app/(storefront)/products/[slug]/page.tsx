import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PdpView } from "@/components/product/PdpView";
import { deliveryWindows } from "@/lib/deliveryWindow";
import { absoluteUrl, buildProductJsonLd } from "@/lib/product-jsonld";
import { serverApiUrl, type Product } from "@/lib/api";
import { STOREFRONT_TAGS } from "@/lib/cache-tags";
import { fetchCategoryInfo, fetchRelatedProducts } from "@/lib/pdp-products";

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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProduct(slug);
  if (!product) return { title: "Product not found" };

  const title = product.seoTitle?.trim() || product.name;
  const description =
    product.metaDescription?.trim() || product.description || undefined;
  // OG/Twitter previews need poster images, not video URLs.
  const images = [...product.images]
    .filter((image) => image.type === "IMAGE")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image) => absoluteUrl(image.url));

  return {
    title,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      title,
      description,
      url: `/products/${product.slug}`,
      type: "website",
      images: images.length > 0 ? images : undefined,
    },
    twitter: {
      card: images.length > 0 ? "summary_large_image" : "summary",
      title,
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

  const [category, related] = await Promise.all([
    fetchCategoryInfo(product.categoryId),
    fetchRelatedProducts(product.categoryId, product.id, { revalidate }),
  ]);

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

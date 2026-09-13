import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PdpClient } from "@/components/product/PdpClient";
import { PdpInfoSections } from "@/components/product/PdpInfoSections";
import { ProductCard } from "@/components/product/ProductCard";
import { ReviewSection } from "@/components/product/ReviewSection";
import { TrustBar } from "@/components/ui/TrustBar";
import { deliveryWindows } from "@/lib/deliveryWindow";
import { serverApiUrl, type Category, type Paged, type Product, type Sku } from "@/lib/api";

export const revalidate = 120;

const SITE_URL = "https://smallhouse.ph";

function absoluteUrl(url: string): string {
  return url.startsWith("/") ? `${SITE_URL}${url}` : url;
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

async function fetchCategoryInfo(
  categoryId: string,
): Promise<{ name: string; slug: string } | null> {
  try {
    const res = await fetch(serverApiUrl("/api/v1/storefront/categories"), {
      next: { revalidate: 300 },
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

/** Product (+ BreadcrumbList) JSON-LD. Omit fields we cannot populate honestly. */
function buildJsonLd(
  product: Product,
  category: { name: string; slug: string } | null,
): Record<string, unknown> {
  const pageUrl = `${SITE_URL}/products/${product.slug}`;
  const images = [...product.images]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image) => absoluteUrl(image.url));

  const sellableSkus = product.variants.flatMap((variant) =>
    variant.sku ? [variant.sku] : [],
  );
  const pricedSkus = sellableSkus.filter(
    (sku): sku is Sku => sku.price !== null,
  );

  const offers =
    pricedSkus.length > 0
      ? {
          "@type": "AggregateOffer",
          priceCurrency: "PHP",
          lowPrice: Math.min(...pricedSkus.map((sku) => sku.price as number)),
          highPrice: Math.max(...pricedSkus.map((sku) => sku.price as number)),
          offerCount: pricedSkus.length,
          availability: sellableSkus.some((sku) => sku.availableInventory > 0)
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          itemCondition: "https://schema.org/NewCondition",
          url: pageUrl,
        }
      : undefined;

  // Aggregate ratings only exist when visible reviews exist; inventing one
  // would be fake-review markup.
  const aggregateRating =
    product.reviewCount > 0 && product.ratingAverage !== null
      ? {
          "@type": "AggregateRating",
          ratingValue: product.ratingAverage,
          reviewCount: product.reviewCount,
          bestRating: 5,
          worstRating: 1,
        }
      : undefined;

  const productLd: Record<string, unknown> = {
    "@type": "Product",
    name: product.name,
    description: product.description ?? undefined,
    image: images.length > 0 ? images : undefined,
    sku: sellableSkus[0]?.skuCode,
    brand: { "@type": "Brand", name: "Small House" },
    category: category?.name,
    offers,
    aggregateRating,
  };

  const crumbs = [
    { name: "Home", url: SITE_URL },
    ...(category ? [{ name: category.name, url: `${SITE_URL}/categories/${category.slug}` }] : []),
    { name: product.name, url: pageUrl },
  ];
  const breadcrumbLd = {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };

  return { "@context": "https://schema.org", "@graph": [productLd, breadcrumbLd] };
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

  const jsonLd = buildJsonLd(product, category);
  const delivery = deliveryWindows();

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-8 pb-24 sm:px-6 md:pb-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // Escape "<" as the JSON escape so admin-authored strings cannot
          // break out of the script tag; JSON parsers still read it as "<".
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <Suspense fallback={null}>
        {/* key remounts the island per product so in-app PDP→PDP navigation
            cannot carry the previous product selected variant into state/URL. */}
        <PdpClient key={product.id} product={product} category={category} delivery={delivery} />
      </Suspense>

      {/* Desktop section anchors; the 64px offset clears the sticky header. */}
      <nav
        aria-label="Product sections"
        className="sticky top-16 z-20 mt-10 hidden gap-6 border-b border-border bg-background/95 py-3 text-sm font-semibold backdrop-blur lg:flex"
      >
        {product.description && (
          <a href="#details" className="text-ink-secondary hover:text-cta">Details</a>
        )}
        <a href="#shipping-faq" className="text-ink-secondary hover:text-cta">Delivery &amp; FAQs</a>
        <a href="#reviews" className="text-ink-secondary hover:text-cta">Reviews</a>
      </nav>

      <section className="mt-12 flex flex-col gap-8 lg:mt-8">
        {product.description && (
          <div id="details" className="scroll-mt-28 rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 text-2xl font-semibold text-ink">Description</h2>
            <p className="whitespace-pre-line text-base leading-relaxed text-ink-secondary">
              {product.description}
            </p>
          </div>
        )}
        <PdpInfoSections />
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

import type { Product, Sku } from "./api";

export const SITE_URL = "https://luwag.ph";

export function absoluteUrl(url: string): string {
  return url.startsWith("/") ? `${SITE_URL}${url}` : url;
}

/** Product (+ BreadcrumbList) JSON-LD. Omit fields we cannot populate honestly. */
export function buildProductJsonLd(
  product: Product,
  /** Full root→leaf category chain (auto-generated from the tree, not hand-entered). */
  categoryChain: { name: string; slug: string }[] | null,
): Record<string, unknown> {
  const pageUrl = `${SITE_URL}/products/${product.slug}`;
  // schema.org `image` expects posters — video entries are excluded.
  const images = [...product.images]
    .filter((image) => image.type === "IMAGE")
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
    brand: { "@type": "Brand", name: "LUWAG Living" },
    category: categoryChain?.[categoryChain.length - 1]?.name,
    offers,
    aggregateRating,
  };

  const crumbs = [
    { name: "Home", url: SITE_URL },
    ...(categoryChain ?? []).map((crumb) => ({
      name: crumb.name,
      url: `${SITE_URL}/categories/${crumb.slug}`,
    })),
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

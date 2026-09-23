import type { Product, StorefrontProductVariant } from "./api";

export const SITE_URL = "https://luwag.ph";

export function absoluteUrl(url: string): string {
  return url.startsWith("/") ? `${SITE_URL}${url}` : url;
}

/**
 * Product (+ BreadcrumbList) JSON-LD. Omit fields we cannot populate honestly.
 *
 * Offers are per-SKU (design spec §12.4): exactly one Offer per ACTIVE,
 * priced SKU — precise `?variant=` URL, per-SKU availability and the option
 * labels as the description — while the Product node itself stays on the
 * queryless canonical PDP URL (`?variant=` never becomes an indexed page).
 */
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

  const offers = product.variants.flatMap((variant) => {
    const sku = variant.sku;
    if (!sku || sku.status !== "ACTIVE" || sku.price === null) return [];
    const description = variantDescription(product, variant);
    return [
      {
        "@type": "Offer",
        sku: sku.skuCode,
        price: sku.price,
        priceCurrency: "PHP",
        itemCondition: "https://schema.org/NewCondition",
        availability:
          sku.availableInventory > 0
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
        url: `${pageUrl}?variant=${encodeURIComponent(variant.id)}`,
        ...(description !== null ? { description } : {}),
      },
    ];
  });

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
    // Same rule as the Offers above: the first ACTIVE, priced SKU — never a
    // disabled or unpriced skuCode that the per-SKU Offers would exclude.
    sku: product.variants.find(
      (variant) =>
        variant.sku &&
        variant.sku.status === "ACTIVE" &&
        variant.sku.price !== null,
    )?.sku?.skuCode,
    brand: { "@type": "Brand", name: "LUWAG Living" },
    category: categoryChain?.[categoryChain.length - 1]?.name,
    url: pageUrl,
    offers: offers.length > 0 ? offers : undefined,
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

/**
 * Offer description from the variant's option labels, ordered by option
 * position: "Color: Red · Size: Large". Falls back to the variant name when
 * the labels cannot be resolved; null when there is nothing to say (the
 * Offer then simply omits the description).
 */
function variantDescription(
  product: Product,
  variant: StorefrontProductVariant,
): string | null {
  const labels: string[] = [];
  for (const option of [...product.options].sort((a, b) => a.position - b.position)) {
    for (const valueId of variant.optionValueIds) {
      const value = option.values.find(({ id }) => id === valueId);
      if (value) labels.push(`${option.name}: ${value.label}`);
    }
  }
  if (labels.length > 0) return labels.join(" · ");
  const name = variant.name.trim();
  return name === "" ? null : name;
}

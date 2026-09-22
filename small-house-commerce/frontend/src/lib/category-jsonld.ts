import type { Category, Product } from "./api";
import { SITE_URL, absoluteUrl } from "./product-jsonld";
import { isInStock, productCardPrice } from "./plp";

/**
 * Storefront category structured data (spec §4.2 P1): BreadcrumbList,
 * CollectionPage, and an ItemList of the server-rendered first page.
 * Values we cannot populate honestly are omitted.
 */
export function buildCategoryJsonLd(
  node: Category,
  parent: Category | null,
  products: Product[],
): Record<string, unknown>[] {
  const pageUrl = `${SITE_URL}/categories/${node.slug}`;

  const crumbs = [
    { name: "Home", item: SITE_URL },
    ...(parent
      ? [{ name: parent.name, item: `${SITE_URL}/categories/${parent.slug}` }]
      : []),
    { name: node.name, item: pageUrl },
  ];
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: crumb.item,
    })),
  };

  const isRoot = node.children.length > 0;
  const collectionPageLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: isRoot ? `Shop ${node.name}` : node.name,
    description: isRoot
      ? `Browse ${node.name} made for small homes in the Philippines. Cash on delivery, nationwide shipping.`
      : undefined,
    url: pageUrl,
  };

  const blocks: Record<string, unknown>[] = [breadcrumbLd, collectionPageLd];

  if (products.length > 0) {
    blocks.push({
      "@context": "https://schema.org",
      "@type": "ItemList",
      numberOfItems: products.length,
      itemListElement: products.map((product, index) => {
        // The backend-computed effective cover and the shared selection
        // contract — never a positional images[0]/variants[0] pick.
        const cover = product.effectiveCoverMedia;
        const price = productCardPrice(product);
        return {
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "Product",
            name: product.name,
            image: cover ? absoluteUrl(cover.url) : undefined,
            url: `${SITE_URL}/products/${product.slug}`,
            offers:
              price !== null
                ? {
                    "@type": "Offer",
                    priceCurrency: "PHP",
                    price: price.price,
                    availability: isInStock(product)
                      ? "https://schema.org/InStock"
                      : "https://schema.org/OutOfStock",
                    url: `${SITE_URL}/products/${product.slug}`,
                  }
                : undefined,
          },
        };
      }),
    });
  }

  return blocks;
}

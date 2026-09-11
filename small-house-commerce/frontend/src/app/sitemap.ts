import type { MetadataRoute } from "next";
import { serverApiUrl, type Collection, type Paged, type Product } from "@/lib/api";

/** SEO §23: sitemap from the live storefront collections and products. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://smallhouse.ph";

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/collections`, changeFrequency: "weekly", priority: 0.8 },
  ];

  let collections: Collection[] = [];
  let products: Product[] = [];
  try {
    const [c, p] = await Promise.all([
      fetch(serverApiUrl("/api/v1/storefront/collections"), { next: { revalidate: 3600 } }),
      fetch(serverApiUrl("/api/v1/storefront/products?pageSize=48"), { next: { revalidate: 3600 } }),
    ]);
    if (c.ok) collections = ((await c.json()) as { items: Collection[] }).items;
    if (p.ok) products = ((await p.json()) as Paged<Product>).items;
  } catch {
    // sitemap degrades to static routes on backend failure
  }

  return [
    ...staticRoutes,
    ...collections.map((collection) => ({
      url: `${base}/collections/${collection.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...products.map((product) => ({
      url: `${base}/products/${product.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}

import type { MetadataRoute } from "next";
import { serverApiUrl, type Category, type Collection, type Paged, type Product } from "@/lib/api";

/** SEO §23: sitemap from the live storefront categories, collections and products. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://smallhouse.ph";

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/collections`, changeFrequency: "weekly", priority: 0.8 },
  ];

  let collections: Collection[] = [];
  let products: Product[] = [];
  let categories: Category[] = [];
  try {
    const [c, p, g] = await Promise.all([
      fetch(serverApiUrl("/api/v1/storefront/collections"), { next: { revalidate: 3600 } }),
      fetch(serverApiUrl("/api/v1/storefront/products?pageSize=48"), { next: { revalidate: 3600 } }),
      fetch(serverApiUrl("/api/v1/storefront/categories"), { next: { revalidate: 3600 } }),
    ]);
    if (c.ok) collections = ((await c.json()) as { items: Collection[] }).items;
    if (p.ok) products = ((await p.json()) as Paged<Product>).items;
    if (g.ok) categories = (await g.json()) as Category[];
  } catch {
    // sitemap degrades to static routes on backend failure
  }

  const categoryRoutes: MetadataRoute.Sitemap = categories.flatMap((root) => [
    { url: `${base}/categories/${root.slug}`, changeFrequency: "weekly" as const, priority: 0.7 },
    ...root.children.map((leaf) => ({
      url: `${base}/categories/${leaf.slug}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ]);

  return [
    ...staticRoutes,
    ...categoryRoutes,
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

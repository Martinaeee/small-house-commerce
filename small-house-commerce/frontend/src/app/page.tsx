import Link from "next/link";
import { CollectionCard } from "@/components/collection/CollectionCard";
import { ProductCard } from "@/components/product/ProductCard";
import { ButtonLink } from "@/components/ui/Button";
import { serverApiUrl, type Collection, type Paged, type Product } from "@/lib/api";

// ISR: product/collection data changes through the admin, not per request.
const REVALIDATE = 120;

async function getHomepageData() {
  try {
    const [collectionsRes, productsRes] = await Promise.all([
      fetch(serverApiUrl("/api/v1/storefront/collections"), { next: { revalidate: REVALIDATE } }),
      fetch(serverApiUrl("/api/v1/storefront/products?pageSize=8"), { next: { revalidate: REVALIDATE } }),
    ]);

    const collections = collectionsRes.ok
      ? ((await collectionsRes.json()) as { items: Collection[] }).items
      : [];
    const products = productsRes.ok
      ? ((await productsRes.json()) as Paged<Product>).items
      : [];

    return { collections, products };
  } catch {
    return { collections: [] as Collection[], products: [] as Product[] };
  }
}

export default async function HomePage() {
  const { collections, products } = await getHomepageData();

  return (
    <>
      {/* Hero (FRONTEND_SPEC §6.1) */}
      <section className="bg-gradient-to-b from-primary-light/50 to-background">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
          <h1 className="max-w-2xl text-4xl font-semibold text-ink sm:text-5xl">
            Smart furniture for your small home
          </h1>
          <p className="max-w-xl text-base text-ink-secondary">
            Foldable, space-saving, rental-friendly furniture delivered
            nationwide. Pay only when it arrives.
          </p>
          <ButtonLink href={collections[0] ? `/collections/${collections[0].slug}` : "/collections"} size="lg">
            Shop Now
          </ButtonLink>
        </div>
      </section>

      {/* Collections (FRONTEND_SPEC §6.1, DESIGN_SYSTEM §14) */}
      {collections.length > 0 && (
        <section className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="text-3xl font-semibold text-ink">Shop by Space</h2>
            <Link href="/collections" className="text-sm text-cta hover:underline">
              View all
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
            {collections.slice(0, 5).map((collection) => (
              <CollectionCard key={collection.id} collection={collection} />
            ))}
          </div>
        </section>
      )}

      {/* Featured products (FRONTEND_SPEC §6.3) */}
      {products.length > 0 && (
        <section className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6">
          <h2 className="mb-6 text-3xl font-semibold text-ink">New Arrivals</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

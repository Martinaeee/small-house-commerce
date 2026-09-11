import Link from "next/link";
import { CollectionCard } from "@/components/collection/CollectionCard";
import { ProductCard } from "@/components/product/ProductCard";
import { ButtonLink } from "@/components/ui/Button";
import { TrustBar } from "@/components/ui/TrustBar";
import { serverApiUrl, type Collection, type Paged, type Product } from "@/lib/api";

// ISR: storefront data changes through the admin, not per request.
const REVALIDATE = 120;

/**
 * HOMEPAGE_SPEC V1.0 §5 IA:
 * Announcement -> Hero -> USP -> Shop by Category -> Small-Space Favorites
 * -> Shop by Solution -> Brand Story -> Purchase Confidence.
 * Hero copy is per §11; solution list per §16. CMS-driven sections
 * (hero fields, featured selection) are marked TODO for the admin slice.
 */

const ANNOUNCEMENT = "Free Metro Manila delivery on orders ₱3,000+ · Cash on Delivery nationwide";

// HOMEPAGE_SPEC §16 solutions -> collection link.
const SOLUTIONS: { name: string; blurb: string; href: string }[] = [
  { name: "Small Bedroom", blurb: "Compact beds, wardrobes and storage", href: "/collections/bedroom-essentials" },
  { name: "Home Office", blurb: "Foldable desks that disappear", href: "/collections/small-space-solutions" },
  { name: "Rental Friendly", blurb: "Portable, non-permanent furniture", href: "/collections/small-space-solutions" },
  { name: "Foldable Furniture", blurb: "Set up and stow in seconds", href: "/collections/small-space-solutions" },
  { name: "Narrow Space", blurb: "Slim profiles for tight corners", href: "/collections/small-space-solutions" },
  { name: "Storage Solution", blurb: "Make every corner useful", href: "/collections/storage-organization" },
];

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

  // §13 category section: the six core collections.
  const categoryCollections = collections.slice(0, 6);

  return (
    <>
      {/* Announcement bar (§5.1) */}
      <div className="bg-cta px-4 py-2 text-center text-xs font-medium text-white sm:text-sm">
        {ANNOUNCEMENT}
      </div>

      {/* Hero (§11): brand -> problem -> solution -> CTA */}
      <section className="bg-gradient-to-b from-primary-light/50 to-background">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-6 px-4 py-16 text-center sm:px-6 sm:py-24">
          <h1 className="max-w-2xl text-4xl font-semibold text-ink sm:text-5xl">
            Small Space.
            <br />
            More Possibilities.
          </h1>
          <p className="max-w-xl text-base text-ink-secondary">
            Furniture designed for condos, rentals and everyday small-space
            living.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink
              href={collections[0] ? `/collections/${collections[0].slug}` : "/collections"}
              size="lg"
            >
              Shop Small-Space Picks
            </ButtonLink>
            <ButtonLink href="#solutions" variant="secondary" size="lg">
              Explore Solutions
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* USP Trust Bar (§12) */}
      <section className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
        <TrustBar />
      </section>

      {/* Shop by Category (§13) */}
      {categoryCollections.length > 0 && (
        <section className="mx-auto max-w-[1200px] px-4 pb-10 sm:px-6">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="text-3xl font-semibold text-ink">Shop by Category</h2>
            <Link href="/collections" className="text-sm text-cta hover:underline">
              View all
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {categoryCollections.map((collection) => (
              <CollectionCard key={collection.id} collection={collection} />
            ))}
          </div>
        </section>
      )}

      {/* Small-Space Favorites (§14). TODO(admin): CMS-controlled selection. */}
      {products.length > 0 && (
        <section className="mx-auto max-w-[1200px] px-4 pb-10 sm:px-6">
          <h2 className="mb-6 text-3xl font-semibold text-ink">Small-Space Favorites</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}

      {/* Shop by Solution (§16) */}
      <section id="solutions" className="mx-auto max-w-[1200px] scroll-mt-20 px-4 py-10 sm:px-6">
        <h2 className="mb-2 text-3xl font-semibold text-ink">Shop by Solution</h2>
        <p className="mb-6 text-ink-secondary">
          Whatever your space problem, there is furniture built for it.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SOLUTIONS.map((solution) => (
            <Link
              key={solution.name}
              href={solution.href}
              className="group flex flex-col gap-1 rounded-lg border border-border bg-card p-5 transition-shadow hover:shadow-md"
            >
              <span className="text-base font-semibold text-ink group-hover:text-cta">
                {solution.name}
              </span>
              <span className="text-sm text-ink-secondary">{solution.blurb}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Brand story (§22) + purchase confidence (§23) */}
      <section className="border-t border-border bg-card">
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-10 px-4 py-12 sm:px-6 md:grid-cols-2">
          <div>
            <h2 className="mb-3 text-2xl font-semibold text-ink">
              Made for real Philippine small spaces
            </h2>
            <p className="text-ink-secondary">
              Condo studios, rental rooms, family homes — we design furniture
              around the space you actually have. Measure, fit, and make every
              corner work.
            </p>
          </div>
          <div className="flex flex-col justify-center gap-2 text-ink-secondary">
            <p className="flex items-center gap-2">
              <span className="font-semibold text-cta">✓</span> Cash on Delivery — pay at your door
            </p>
            <p className="flex items-center gap-2">
              <span className="font-semibold text-cta">✓</span> Nationwide delivery
            </p>
            <p className="flex items-center gap-2">
              <span className="font-semibold text-cta">✓</span> Real-time order updates by phone
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

import { Suspense, type ReactNode } from "react";
import { PdpClient } from "./PdpClient";
import { PdpInfoSections } from "./PdpInfoSections";
import { ProductCard } from "./ProductCard";
import { ReviewSection } from "./ReviewSection";
import { TrustBar } from "@/components/ui/TrustBar";
import type { DeliveryWindows } from "@/lib/deliveryWindow";
import type { Product } from "@/lib/api";

/**
 * Shared PDP body for both /products/[slug] and /lp/[slug]. The LP route
 * supplies a merged product (overridden name/images) and optional promoSlot;
 * everything else (reviews, specs, price, related) is the shared product.
 */
export function PdpView({
  product,
  category,
  delivery,
  related,
  jsonLd,
  promoSlot,
  productPath,
}: {
  product: Product;
  category: { name: string; slug: string } | null;
  delivery: DeliveryWindows;
  related: Product[];
  jsonLd: unknown;
  promoSlot?: ReactNode;
  productPath?: string;
}) {
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
        <PdpClient
          key={product.id}
          product={product}
          category={category}
          delivery={delivery}
          productPath={productPath}
          promoSlot={promoSlot}
        />
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

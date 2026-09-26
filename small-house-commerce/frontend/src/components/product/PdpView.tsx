import { Suspense, type ReactNode } from "react";
import { PdpClient } from "./PdpClient";
import { PdpPurchaseProvider } from "./PdpPurchaseProvider";
import { PdpDetails } from "./PdpDetails";
import { PdpSectionNavGate } from "./PdpSectionNavGate";
import { PdpQuickCodOrder } from "./PdpQuickCodOrder";
import { ProductCard } from "./ProductCard";
import { ReviewSection } from "./ReviewSection";
import { RecentlyViewed } from "@/components/home/RecentlyViewed";
import { TrustBar } from "@/components/ui/TrustBar";
import { fetchSiteSettings } from "@/lib/site-settings";
import type { DeliveryWindows } from "@/lib/deliveryWindow";
import type { Product } from "@/lib/api";
import type { CategoryCrumb } from "@/app/(storefront)/products/[slug]/page";

/**
 * Shared PDP body for both /products/[slug] and /lp/[slug]. The LP route
 * supplies a merged product (overridden name/images) and optional promoSlot;
 * everything else (reviews, specs, price, related) is the shared product.
 */
export async function PdpView({
  product,
  category,
  delivery,
  related,
  jsonLd,
  promoSlot,
  productPath,
  initialVariantId,
}: {
  product: Product;
  /** Full root→leaf breadcrumb chain, auto-generated from the category tree. */
  category: CategoryCrumb[] | null;
  delivery: DeliveryWindows;
  related: Product[];
  jsonLd: unknown;
  promoSlot?: ReactNode;
  productPath?: string;
  initialVariantId?: string | null;
}): Promise<ReactNode> {
  // Request-deduped with the layout's identical fetch (same URL + ISR tag).
  const settings = await fetchSiteSettings();
  // Description text and media blocks are one section; the anchor only earns
  // its place when at least one of them has something to show.
  const detailBlocks = product.detailBlocks ?? [];
  const hasDetails =
    Boolean(product.description?.trim()) ||
    Boolean(product.features?.trim()) ||
    detailBlocks.some((block) => block.url.trim() !== "");
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
        <PdpPurchaseProvider
          product={product}
          initialVariantId={initialVariantId}
        >
          <PdpClient
            product={product}
            category={category}
            delivery={delivery}
            productPath={productPath}
            promoSlot={promoSlot}
          />

          <PdpSectionNavGate product={product} hasDetails={hasDetails} />

          <section className="mt-12 flex flex-col gap-8 lg:mt-8">
            <PdpDetails
              product={product}
              supportEmail={settings.supportEmail}
              supportHours={settings.supportHours}
            />
            <PdpQuickCodOrder />
            <ReviewSection product={product} />
            <TrustBar />
          </section>
        </PdpPurchaseProvider>
      </Suspense>

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

      <RecentlyViewed excludeProductId={product.id} limit={4} />
    </div>
  );
}

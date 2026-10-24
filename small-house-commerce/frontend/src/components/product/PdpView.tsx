import { Suspense, type ReactNode } from "react";
import { PdpClient } from "./PdpClient";
import { PdpPurchaseProvider } from "./PdpPurchaseProvider";
import { PdpDetails } from "./PdpDetails";
import { pdpHasDetails } from "./pdp-details-visibility";
import { PdpSectionNavGate } from "./PdpSectionNavGate";
import { PdpQuickCodOrder } from "./PdpQuickCodOrder";
import { PdpRecommendations } from "./PdpRecommendations";
import { ProductFeedback } from "./ProductFeedback";
import { RecentlyViewed } from "@/components/home/RecentlyViewed";
import { TrustBar } from "@/components/ui/TrustBar";
import { fetchSiteSettings } from "@/lib/site-settings";
import type { DeliveryWindows } from "@/lib/deliveryWindow";
import type { Product } from "@/lib/api";
import type { CategoryCrumb } from "@/lib/pdp-products";

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
  // The anchor only earns its place when the section has something to show —
  // hidden feature bullets and the switched-off module do not count.
  const hasDetails = pdpHasDetails(product);
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
            hideSellingPoints={settings.hideSellingPoints}
          />

          <PdpSectionNavGate product={product} hasDetails={hasDetails} />

          <section className="mt-6 flex flex-col gap-8">
            <PdpDetails product={product} />
            <PdpQuickCodOrder />
            <ProductFeedback
              product={product}
              supportEmail={settings.supportEmail}
              supportHours={settings.supportHours}
            />
            <TrustBar />
          </section>
        </PdpPurchaseProvider>
      </Suspense>

      {related.length > 0 && (
        <PdpRecommendations currentProduct={product} fallback={related} />
      )}

      <RecentlyViewed excludeProductId={product.id} limit={4} />
    </div>
  );
}

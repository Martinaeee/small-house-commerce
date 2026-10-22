import type { Product } from "@/lib/api";
import { ProductCard } from "@/components/product/ProductCard";

/**
 * The product row under the order-tracking page.
 *
 * It sits below the lookup form AND below the order details: a shopper who
 * came to check an order often keeps browsing, and the track-order page is
 * one of the few pages that a returning customer visits on purpose.
 *
 * The products are the store's own published products, newest first - not a
 * personalised pick. When there is nothing to offer the section disappears
 * instead of leaving an empty heading behind.
 */
export function TrackRecommendations({ products }: { products: Product[] }) {
  if (products.length === 0) return null;

  return (
    <section
      data-testid="track-recommendations"
      className="px-4 sm:px-6"
    >
      <div className="mx-auto mt-14 max-w-[1200px] border-t border-border pt-8">
        <h2 className="text-[22px] font-semibold text-ink">You May Also Like</h2>
        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </section>
  );
}

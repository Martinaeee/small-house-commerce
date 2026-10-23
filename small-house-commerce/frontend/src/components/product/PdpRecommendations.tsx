"use client";

import type { Product } from "@/lib/api";
import { useCart } from "@/components/cart/CartContext";
import { useCartRecommendations } from "@/lib/useCartRecommendations";
import { ProductCard } from "./ProductCard";

/** The PDP rail shows four cards; 3–5 is the requested band. */
const PDP_RECOMMENDATION_TAKE = 4;

/**
 * "You May Also Like" rail under the product page. Server-side related
 * products are the first paint; once the cart has lines the shared cart
 * recommender takes over, so a product just added to the cart drops out
 * immediately and another one replaces it. The current product and every
 * cart line are never recommended.
 */
export function PdpRecommendations({
  currentProduct,
  fallback,
}: {
  currentProduct: Product;
  fallback: Product[];
}) {
  const { cart } = useCart();
  const fromCart = useCartRecommendations(cart, PDP_RECOMMENDATION_TAKE);
  const cartSlugs = new Set(
    (cart?.items ?? []).map((item) => item.productSlug),
  );
  const eligible = (product: Product) =>
    product.id !== currentProduct.id &&
    product.slug !== currentProduct.slug &&
    !cartSlugs.has(product.slug);

  const source = fromCart.length > 0 ? fromCart : fallback;
  const list = source
    .filter(eligible)
    .slice(0, PDP_RECOMMENDATION_TAKE);

  if (list.length === 0) return null;

  return (
    <section className="mt-12" aria-label="Recommended products">
      <h2 className="mb-6 text-2xl font-semibold text-ink">You May Also Like</h2>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        {list.map((product) => (
          <li
            key={product.id}
            className="w-56 shrink-0 snap-start sm:w-64"
          >
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}

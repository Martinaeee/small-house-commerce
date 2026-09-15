"use client";

import { useEffect, useState } from "react";
import { ProductCard } from "@/components/product/ProductCard";
import { SectionHeading, SectionShell } from "./sectionShell";
import { api, type Product } from "@/lib/api";
import { getRecentProductIds } from "@/lib/recently-viewed";

/** IA slot 13. Renders nothing until the browser has a non-empty sh:rv list. */
export function RecentlyViewed() {
  const [products, setProducts] = useState<Product[] | null>(null);

  useEffect(() => {
    const ids = getRecentProductIds();
    // Empty list: leave state at null — the render guard renders nothing,
    // identical to [] — which avoids a synchronous setState in this effect.
    if (ids.length === 0) return;
    let active = true;
    api
      .getProductsByIds(ids)
      .then((res) => {
        if (!active) return;
        const byId = new Map(res.items.map((product) => [product.id, product]));
        // Backend filters ACTIVE; keep the localStorage visit order.
        setProducts(
          ids
            .map((id) => byId.get(id))
            .filter((product): product is Product => product !== undefined),
        );
      })
      .catch(() => {
        if (active) setProducts([]);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!products || products.length === 0) return null;

  return (
    <SectionShell>
      <SectionHeading title="Recently Viewed" />
      {/* Spec §5.4: horizontal scrolling rail. Card keeps its 4:5 image. */}
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] sm:mx-0 sm:px-0">
        {products.map((product) => (
          <div key={product.id} className="w-44 shrink-0 sm:w-56">
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

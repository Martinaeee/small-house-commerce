"use client";

import type { Product } from "@/lib/api";
import type { CardBadge } from "@/lib/plpBadges";
import { ProductCard } from "./ProductCard";

export function PlpProductCard({ product, badges }: { product: Product; badges: readonly CardBadge[] }) {
  return <ProductCard product={product} badges={badges} />;
}

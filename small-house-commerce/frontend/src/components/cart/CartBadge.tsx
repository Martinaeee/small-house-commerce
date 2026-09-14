// src/components/cart/CartBadge.tsx
"use client";

import { useCart } from "./CartContext";

/**
 * Red count bubble on the header cart icon: number of distinct products
 * (A×1 + B×2 shows 2; two variants of the same product count as 1).
 */
export function CartBadge() {
  const { itemKindCount } = useCart();
  if (itemKindCount === 0) return null;

  return (
    <span
      data-testid="cart-badge"
      className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-sale px-1 text-[10px] font-bold leading-none text-white"
    >
      {itemKindCount > 99 ? "99+" : itemKindCount}
    </span>
  );
}

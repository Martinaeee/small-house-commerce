// src/components/product/MobileStickyCta.tsx
"use client";

import { Button } from "@/components/ui/Button";
import { PriceBox } from "@/components/ui/PriceBox";

/** PDP_SPEC §12: fixed name + price + ORDER NOW, mobile only. */
export function MobileStickyCta({
  name,
  price,
  compareAtPrice,
  outOfStock,
  busy,
  onOrderNow,
}: {
  name: string;
  price: number | null;
  compareAtPrice: number | null;
  outOfStock: boolean;
  busy: boolean;
  onOrderNow: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{name}</p>
          <PriceBox price={price} compareAtPrice={compareAtPrice} />
        </div>
        <Button
          onClick={onOrderNow}
          disabled={busy || outOfStock}
          size="md"
          className="shrink-0"
          data-testid="sticky-order-now"
        >
          {outOfStock ? "Out of Stock" : "ORDER NOW"}
        </Button>
      </div>
    </div>
  );
}

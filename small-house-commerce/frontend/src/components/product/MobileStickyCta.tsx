// src/components/product/MobileStickyCta.tsx
"use client";

import { Button } from "@/components/ui/Button";
import { PriceBox } from "@/components/ui/PriceBox";

/** PDP_SPEC §12: fixed name + price + ORDER NOW, mobile only.
 *  Out of stock: ADD TO CART (cart allows saving OOS items) plus a mailto
 *  contact link when provided. */
export function MobileStickyCta({
  name,
  price,
  compareAtPrice,
  outOfStock,
  busy,
  contactHref,
  onOrderNow,
  onAddToCart,
}: {
  name: string;
  price: number | null;
  compareAtPrice: number | null;
  outOfStock: boolean;
  busy: boolean;
  contactHref?: string | null;
  onOrderNow: () => void;
  onAddToCart: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{name}</p>
          <PriceBox price={price} compareAtPrice={compareAtPrice} />
        </div>
        {outOfStock ? (
          <div className="flex shrink-0 items-center gap-2">
            {contactHref && (
              <a
                href={contactHref}
                className="inline-flex h-12 min-w-[96px] items-center justify-center rounded-lg border border-cta/40 px-3 text-sm font-semibold text-cta hover:bg-primary-light/40"
                data-testid="sticky-contact"
              >
                Contact
              </a>
            )}
            <Button
              onClick={onAddToCart}
              disabled={busy}
              size="md"
              className="shrink-0"
              data-testid="sticky-add-to-cart"
            >
              ADD TO CART
            </Button>
          </div>
        ) : (
          <Button
            onClick={onOrderNow}
            disabled={busy}
            size="md"
            className="shrink-0"
            data-testid="sticky-order-now"
          >
            ORDER NOW
          </Button>
        )}
      </div>
    </div>
  );
}

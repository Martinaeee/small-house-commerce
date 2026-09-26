"use client";

import {
  useEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { Product, ProductImage } from "@/lib/api";
import type { ProductSelectionDerived } from "@/lib/product-selection";
import { Button, ButtonLink } from "@/components/ui/Button";
import { PriceBox } from "@/components/ui/PriceBox";
import type { PurchaseLineState } from "./PdpPurchaseProvider";

export type StickyPurchaseIntent = "ADD_TO_CART" | "ORDER_NOW";

export interface PdpStickyBuyProps {
  product: Product;
  coverMedia: ProductImage | null;
  restockHref: string;
  heroRef: RefObject<HTMLElement | null>;
  line: PurchaseLineState;
  derived: ProductSelectionDerived;
  busy: boolean;
  variantLabel: string | null;
  onQuantityChange(quantity: number): void;
  onIntent(intent: StickyPurchaseIntent, trigger: HTMLElement): void;
}

export function PdpStickyBuy({
  product,
  coverMedia,
  restockHref,
  heroRef,
  line,
  derived,
  busy,
  variantLabel,
  onQuantityChange,
  onIntent,
}: PdpStickyBuyProps): ReactNode {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry ? !entry.isIntersecting : false);
    });
    observer.observe(hero);
    return () => observer.disconnect();
  }, [heroRef]);

  useEffect(() => {
    if (!visible || typeof window.matchMedia !== "function") return;
    const mobile = window.matchMedia("(max-width: 767px)");
    const previous = document.body.style.paddingBottom;
    const apply = () => {
      document.body.style.paddingBottom = mobile.matches
        ? "calc(7rem + env(safe-area-inset-bottom))"
        : previous;
    };
    apply();
    mobile.addEventListener?.("change", apply);
    return () => {
      mobile.removeEventListener?.("change", apply);
      document.body.style.paddingBottom = previous;
    };
  }, [visible]);

  if (!visible) return null;

  const resolvedOutOfStock =
    derived.resolvedVariant !== null && derived.availableInventory <= 0;
  const unavailable = derived.selectableVariants.length === 0;
  const orderLabel = derived.resolvedVariant ? "ORDER NOW" : "CHOOSE OPTIONS";
  const addLabel =
    derived.selectableVariants.length > 1 && !derived.resolvedVariant
      ? "CHOOSE OPTIONS"
      : "ADD TO CART";

  return (
    <aside
      data-testid="sticky-buy"
      aria-label="Sticky purchase controls"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_28px_rgba(0,0,0,0.08)] backdrop-blur motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-reduce:transition-none sm:px-4 md:py-3"
    >
      <div className="mx-auto flex max-w-[1200px] items-center gap-2 sm:gap-3">
        {coverMedia ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverMedia.url}
            alt={coverMedia.altText ?? product.name}
            className="hidden h-14 w-14 shrink-0 rounded-md border border-border object-cover md:block"
          />
        ) : null}

        <div className="hidden min-w-0 flex-1 md:block">
          <p className="truncate text-sm font-semibold text-ink">
            {product.name}
          </p>
          <p className="truncate text-xs text-ink-secondary">
            {variantLabel ?? "Choose your options"}
          </p>
        </div>

        <div className="min-w-0 shrink-0">
          <PriceBox
            price={derived.price}
            compareAtPrice={derived.compareAtPrice}
          />
          <p className="max-w-24 truncate text-[11px] text-ink-secondary md:hidden">
            {variantLabel ?? "Choose options"}
          </p>
        </div>

        <div className="ml-auto hidden items-center rounded-lg border border-border bg-card lg:flex">
          <button
            type="button"
            aria-label="Decrease sticky quantity"
            onClick={() => onQuantityChange(line.quantity - 1)}
            className="h-10 w-10 text-lg text-ink hover:text-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
          >
            −
          </button>
          <span
            data-testid="sticky-qty"
            className="w-7 text-center text-sm font-semibold text-ink"
          >
            {line.quantity}
          </span>
          <button
            type="button"
            aria-label="Increase sticky quantity"
            onClick={() => onQuantityChange(line.quantity + 1)}
            className="h-10 w-10 text-lg text-ink hover:text-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
          >
            +
          </button>
        </div>

        {resolvedOutOfStock ? (
          <ButtonLink
            href={restockHref}
            size="md"
            variant="secondary"
            className="min-w-0 shrink px-3 text-xs sm:min-w-[120px] sm:px-5 sm:text-sm"
            data-testid="sticky-contact-restock"
          >
            Contact us to order
          </ButtonLink>
        ) : (
          <Button
            size="md"
            onClick={(event) => onIntent("ORDER_NOW", event.currentTarget)}
            disabled={busy || unavailable}
            className="min-w-0 shrink px-3 text-xs sm:min-w-[120px] sm:px-5 sm:text-sm"
            data-testid="sticky-order-now"
          >
            {orderLabel}
          </Button>
        )}
        <Button
          size="md"
          variant={resolvedOutOfStock ? "primary" : "secondary"}
          onClick={(event) => onIntent("ADD_TO_CART", event.currentTarget)}
          disabled={busy || unavailable}
          className="min-w-0 shrink px-3 text-xs sm:min-w-[120px] sm:px-5 sm:text-sm"
          data-testid="sticky-add-to-cart"
        >
          {addLabel}
        </Button>
      </div>
    </aside>
  );
}

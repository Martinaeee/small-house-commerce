"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { Product, ProductImage } from "@/lib/api";
import type { ProductSelectionDerived } from "@/lib/product-selection";
import { Button } from "@/components/ui/Button";
import { BackInStockTrigger } from "@/components/back-in-stock/BackInStockTrigger";
import { PriceBox, formatPrice } from "@/components/ui/PriceBox";
import type { PurchaseLineState } from "./PdpPurchaseProvider";

export type StickyPurchaseIntent = "ADD_TO_CART" | "ORDER_NOW";

/**
 * The first few words of a product name. The phone sticky bar has room for
 * this much and no more; the rest of the name stays on the page.
 */
function firstWords(text: string, count: number): string {
  return text.trim().split(/\s+/).slice(0, count).join(" ");
}

export interface PdpStickyBuyProps {
  product: Product;
  coverMedia: ProductImage | null;
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
  heroRef,
  line,
  derived,
  busy,
  variantLabel,
  onQuantityChange,
  onIntent,
}: PdpStickyBuyProps): ReactNode {
  const [visible, setVisible] = useState(false);
  const [codInView, setCodInView] = useState(false);
  const barRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry ? !entry.isIntersecting : false);
    });
    observer.observe(hero);
    return () => observer.disconnect();
  }, [heroRef]);

  // The inline COD form carries its own selection and submit, so the fixed
  // bar yields while that section is on screen instead of stacking a second
  // purchase UI over it. The section id is the same contract the COD form
  // and the E2E gates already use.
  useEffect(() => {
    const section = document.getElementById("quick-cod-order");
    if (!section || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setCodInView(entry?.isIntersecting ?? false),
      // Require the section to reach the upper 60% of the viewport, so the
      // bar stays while the COD section only peeks in from the bottom edge.
      { rootMargin: "0px 0px -40% 0px", threshold: 0 },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const shown = visible && !codInView;

  // The bar is fixed, so the document must reserve exactly its height or the
  // last of the footer sits underneath it. Measuring (instead of a per-breakpoint
  // constant) keeps mobile, desktop and safe-area insets correct in one rule.
  useEffect(() => {
    if (!shown) return;
    const bar = barRef.current;
    if (!bar) return;
    const previous = document.body.style.paddingBottom;
    const apply = () => {
      const height = Math.ceil(bar.getBoundingClientRect().height);
      document.body.style.paddingBottom = `${height}px`;
      // Teaches the floating support bubble how tall the bar is, so the bubble
      // sits above it instead of covering ADD TO CART. Scoped to this page
      // while the bar is on screen.
      document.documentElement.style.setProperty(
        "--sticky-bar-offset",
        `${height}px`,
      );
    };
    apply();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
    observer?.observe(bar);
    window.addEventListener("resize", apply);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", apply);
      document.body.style.paddingBottom = previous;
      document.documentElement.style.removeProperty("--sticky-bar-offset");
    };
  }, [shown]);

  if (!shown) return null;

  const resolvedSku = derived.resolvedVariant?.sku ?? null;
  const resolvedOutOfStock =
    resolvedSku !== null && derived.availableInventory <= 0;
  const unavailable = derived.selectableVariants.length === 0;

  // The phone bar shows what the shopper is buying: a small cover, the first
  // words of the name and the price of the selected variant.
  const summaryName = firstWords(product.name, 3);
  const summaryPrice =
    derived.price !== null
      ? formatPrice(derived.price)
      : (variantLabel ?? "Choose options");

  return (
    <aside
      ref={barRef}
      data-testid="sticky-buy"
      aria-label="Sticky purchase controls"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_28px_rgba(0,0,0,0.08)] backdrop-blur motion-safe:animate-in motion-safe:slide-in-from-bottom-2 motion-reduce:transition-none sm:px-4 md:py-3"
    >
      {/* Phones get three zones in one row: what the shopper is buying,
          ORDER NOW, ADD TO CART. Nothing wraps and nothing scrolls sideways,
          so both actions stay reachable on a 375px screen. From sm up the row
          keeps the wider layout and may scroll if it ever has to. */}
      <div className="mx-auto flex max-w-[1200px] items-center gap-1.5 sm:gap-3 sm:overflow-x-auto sm:overscroll-x-contain">
        {/* ① Phone: the product being bought. */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:hidden">
          {coverMedia ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverMedia.url}
              alt=""
              aria-hidden="true"
              className="h-7 w-7 shrink-0 rounded-md border border-border object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] leading-tight tracking-tight text-ink">
              {summaryName}
            </p>
            <p
              data-testid="sticky-summary-price"
              className="truncate text-[13px] font-semibold leading-tight text-ink"
            >
              {summaryPrice}
            </p>
          </div>
        </div>

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

        <div className="hidden min-w-0 shrink-0 sm:block">
          <PriceBox
            price={derived.price}
            compareAtPrice={derived.compareAtPrice}
            hideDiscountBadgeOnMobile
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
            disabled={busy}
            className="h-10 w-10 text-lg text-ink hover:text-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta disabled:cursor-not-allowed disabled:opacity-50"
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
            disabled={busy}
            className="h-10 w-10 text-lg text-ink hover:text-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta disabled:cursor-not-allowed disabled:opacity-50"
          >
            +
          </button>
        </div>

        {resolvedOutOfStock && resolvedSku ? (
          <BackInStockTrigger
            skuId={resolvedSku.id}
            productName={product.name}
            className="inline-flex h-9 min-w-0 shrink items-center justify-center rounded-lg border border-border bg-card px-2.5 text-center text-xs font-semibold leading-tight text-cta transition hover:border-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta sm:h-10 sm:min-w-[120px] sm:px-5 sm:text-sm"
          />
        ) : (
          <Button
            size="sm"
            onClick={(event) => onIntent("ORDER_NOW", event.currentTarget)}
            disabled={busy || unavailable}
            className="shrink-0 whitespace-nowrap sm:h-12 sm:min-w-[120px] sm:px-5 sm:text-sm lg:text-base"
            data-testid="sticky-order-now"
          >
            ORDER NOW
          </Button>
        )}
        <Button
          size="sm"
          variant={resolvedOutOfStock ? "primary" : "secondary"}
          onClick={(event) => onIntent("ADD_TO_CART", event.currentTarget)}
          disabled={busy || unavailable}
          className="shrink-0 whitespace-nowrap sm:h-12 sm:min-w-[120px] sm:px-5 sm:text-sm lg:text-base"
          data-testid="sticky-add-to-cart"
        >
          ADD TO CART
        </Button>
      </div>
    </aside>
  );
}

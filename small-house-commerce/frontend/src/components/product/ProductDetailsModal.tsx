// src/components/product/ProductDetailsModal.tsx
"use client";

import { useEffect, useRef, type ReactNode, type TouchEvent } from "react";
import type { Product } from "@/lib/api";
import { DimensionRows } from "./SizeGuide";

function Section({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="border-b border-border py-4 last:border-0 [&_summary]:cursor-pointer"
    >
      <summary className="flex list-none items-center justify-between text-base font-semibold text-ink">
        {title}
        <span className="text-ink-muted">⌄</span>
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

export function ProductDetailsModal({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // Mobile swipe-down-to-close (spec §5). The gesture lives on the grab bar
  // only, so the scrollable accordion content keeps normal touch scrolling.
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const snapTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(snapTimerRef.current), []);

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    dragStartYRef.current = e.touches[0].clientY;
    const panel = sheetRef.current;
    if (panel) panel.style.transition = "none";
  };

  const handleTouchCancel = () => {
    dragStartYRef.current = null;
    const panel = sheetRef.current;
    if (panel) panel.style.transform = "";
  };

  const handleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (dragStartYRef.current === null) return;
    if (e.touches.length !== 1) {
      handleTouchCancel();
      return;
    }
    const dy = Math.max(0, e.touches[0].clientY - dragStartYRef.current);
    const panel = sheetRef.current;
    if (panel) panel.style.transform = `translateY(${dy}px)`;
  };

  const snapBack = () => {
    const panel = sheetRef.current;
    if (!panel) return;
    panel.style.transition = "transform 200ms ease";
    panel.style.transform = "translateY(0px)";
    window.clearTimeout(snapTimerRef.current);
    snapTimerRef.current = window.setTimeout(() => {
      panel.style.transition = "";
      panel.style.transform = "";
    }, 200);
  };

  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    if (dragStartYRef.current === null) return;
    const startY = dragStartYRef.current;
    dragStartYRef.current = null;
    const dy = Math.max(0, e.changedTouches[0].clientY - startY);
    if (dy >= 80) {
      onClose();
    } else {
      snapBack();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Product details"
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl bg-background sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile swipe-down affordance (spec §5); gesture is bound to the bar. */}
        <div className="flex justify-center pt-3 sm:hidden">
          <div
            aria-hidden="true"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchCancel}
            className="h-1 w-10 shrink-0 cursor-grab touch-none rounded-full bg-border active:cursor-grabbing"
          />
        </div>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-ink">Product details</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close product details"
            className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-ink-secondary hover:bg-border/50"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-6">
          <Section title="Dimensions" defaultOpen>
            <DimensionRows product={product} />
          </Section>

          {product.description && (
            <Section title="Details">
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-secondary">
                {product.description}
              </p>
            </Section>
          )}

          <Section title="Delivery, warranty and returns">
            <dl>
              <div className="flex justify-between gap-4 border-b border-border py-2">
                <dt className="text-sm text-ink-secondary">Delivery</dt>
                <dd className="text-right text-sm font-medium text-ink">
                  Metro Manila 3–5 days, provinces 5–7 days
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-border py-2">
                <dt className="text-sm text-ink-secondary">Payment</dt>
                <dd className="text-right text-sm font-medium text-ink">Cash on Delivery</dd>
              </div>
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}

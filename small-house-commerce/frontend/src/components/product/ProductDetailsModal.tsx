// src/components/product/ProductDetailsModal.tsx
"use client";

import { useEffect, type ReactNode } from "react";
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Product details"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl bg-background sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
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

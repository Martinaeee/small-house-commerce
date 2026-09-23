"use client";
import Link from "next/link";
import { formatPrice } from "@/components/ui/PriceBox";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { formatOrderOptionsText } from "@/lib/order-options";
import type { CheckoutLine } from "./checkoutItems";

function PreviewRow({ line }: { line: CheckoutLine }) {
  // Structured option pairs are authoritative on the checkout line; the
  // legacy variant text is the fallback (legacy cart rows, optionless SKUs).
  const optionsText =
    line.options.length > 0 ? formatOrderOptionsText(line.options) : line.variant;
  return (
    <li className="flex gap-3 py-2">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border">
        {line.thumbnail ? (
          line.thumbnail.type === "VIDEO" ? (
            <video
              src={line.thumbnail.url}
              muted
              playsInline
              preload="metadata"
              aria-label={line.thumbnail.altText ?? line.name}
              className="h-full w-full object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={line.thumbnail.url}
              alt={line.thumbnail.altText ?? ""}
              className="h-full w-full object-cover"
            />
          )
        ) : (
          <PlaceholderImage label="" className="h-full w-full" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <Link
          href={`/products/${line.slug}`}
          className="line-clamp-2 text-sm font-medium text-ink hover:text-cta"
        >
          {line.name}
        </Link>
        <p className="mt-0.5 text-xs text-ink-muted">
          {optionsText ? `${optionsText} · ` : ""}Qty {line.quantity}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {line.unitPrice !== null ? (
          <>
            {line.compareAtPrice != null && line.compareAtPrice > line.unitPrice && (
              <p className="text-xs text-ink-muted line-through">
                {formatPrice(line.compareAtPrice * line.quantity)}
              </p>
            )}
            <p className="text-sm font-semibold text-ink">
              {formatPrice(line.unitPrice * line.quantity)}
            </p>
            {line.quantity > 1 && (
              <p className="text-xs text-ink-muted">{formatPrice(line.unitPrice)} each</p>
            )}
          </>
        ) : (
          <span className="text-sm text-ink-muted">—</span>
        )}
      </div>
    </li>
  );
}

export function OrderPreview({ lines }: { lines: CheckoutLine[] }) {
  return (
    <ul className="divide-y divide-border">
      {lines.map((line) => (
        <PreviewRow key={line.key} line={line} />
      ))}
    </ul>
  );
}

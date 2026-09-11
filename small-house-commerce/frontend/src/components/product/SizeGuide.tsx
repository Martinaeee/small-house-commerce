// src/components/product/SizeGuide.tsx
import type { Product } from "@/lib/api";

/** PDP_SPEC §19 fit data, rendered inside the Product Details sheet. */

function Row({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-2 last:border-0">
      <dt className="text-sm text-ink-secondary">{label}</dt>
      <dd className="text-right text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

function cm(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : `${value} cm`;
}

export function DimensionRows({ product }: { product: Product }) {
  const hasDimensions =
    product.width !== null || product.height !== null || product.depth !== null;
  const hasFolded =
    product.foldedWidth !== null ||
    product.foldedHeight !== null ||
    product.foldedDepth !== null;

  if (!hasDimensions && !hasFolded) return null;

  return (
    <dl>
      {hasDimensions && (
        <>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Product size
          </p>
          <Row label="Width" value={cm(product.width)} />
          <Row label="Height" value={cm(product.height)} />
          <Row label="Depth" value={cm(product.depth)} />
        </>
      )}
      {hasFolded && (
        <>
          <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Folded size
          </p>
          <Row label="Width" value={cm(product.foldedWidth)} />
          <Row label="Folded height" value={cm(product.foldedHeight)} />
          <Row label="Folded depth" value={cm(product.foldedDepth)} />
        </>
      )}
      <p className="mt-3 text-xs text-ink-muted">
        Measurements may vary slightly. Measure your doorway before delivery.
      </p>
    </dl>
  );
}

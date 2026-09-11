import type { Product } from "@/lib/api";

/**
 * PDP_SPEC §19 Size Guide — furniture needs fit confidence. Shows product
 * dimensions, folded dimensions (when foldable) and package dimensions from
 * the SKU. Only renders when dimension data exists.
 */

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <tr className="border-b border-border last:border-0">
      <th scope="row" className="py-2 pr-4 text-left text-sm font-medium text-ink-secondary">
        {label}
      </th>
      <td className="py-2 text-right text-sm font-semibold text-ink">{value ?? "—"}</td>
    </tr>
  );
}

function cm(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : `${value} cm`;
}

function kg(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : `${value} kg`;
}

export function SizeGuide({ product }: { product: Product }) {
  const sku = product.variants[0]?.sku ?? null;
  const hasDimensions =
    product.width !== null || product.height !== null || product.depth !== null;
  const hasFolded =
    product.foldedWidth !== null || product.foldedHeight !== null || product.foldedDepth !== null;
  const hasPackage =
    sku?.packageWidth != null || sku?.packageHeight != null || sku?.packageDepth != null;

  if (!hasDimensions && !hasFolded && !hasPackage) return null;

  return (
    <section aria-label="Size guide" className="rounded-lg border border-border bg-card p-6">
      <h2 className="mb-4 text-2xl font-semibold text-ink">Size Guide</h2>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {hasDimensions && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Product Size</h3>
            <table className="w-full">
              <tbody>
                <Row label="Width" value={cm(product.width)} />
                <Row label="Height" value={cm(product.height)} />
                <Row label="Depth" value={cm(product.depth)} />
              </tbody>
            </table>
          </div>
        )}

        {hasFolded && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Folded Size</h3>
            <table className="w-full">
              <tbody>
                <Row label="Width" value={cm(product.foldedWidth)} />
                <Row label="Height" value={cm(product.foldedHeight)} />
                <Row label="Depth" value={cm(product.foldedDepth)} />
              </tbody>
            </table>
          </div>
        )}

        {hasPackage && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Package Size</h3>
            <table className="w-full">
              <tbody>
                <Row label="Width" value={cm(sku?.packageWidth)} />
                <Row label="Height" value={cm(sku?.packageHeight)} />
                <Row label="Depth" value={cm(sku?.packageDepth)} />
                <Row label="Weight" value={kg(sku?.packageWeight ?? sku?.productWeight)} />
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-4 text-xs text-ink-muted">
        Measurements may vary slightly. Measure your doorway before delivery.
      </p>
    </section>
  );
}

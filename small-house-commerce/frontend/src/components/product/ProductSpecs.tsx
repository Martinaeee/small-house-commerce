// src/components/product/ProductSpecs.tsx
import type { ReactNode } from "react";
import { DimensionRows, type SpecDimensions } from "./SizeGuide";

/** Narrow spec source so the admin live preview can pass a plain object. */
export interface ProductSpecSource extends SpecDimensions {
  materials?: string | null;
  features?: string | null;
}

/**
 * Structured Specifications section for the PDP details area. Reads only the
 * structured product columns (dimensions, materials, features) — operators
 * never type this into the description. Rendered only when at least one of
 * the three has content; hidden entirely otherwise.
 */
export function ProductSpecs({ product }: { product: ProductSpecSource }): ReactNode {
  const materials = product.materials?.trim() ?? "";
  const features = (product.features ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const hasSpecs = materials !== "" || features.length > 0;
  const hasDimensions =
    product.width !== null ||
    product.height !== null ||
    product.depth !== null ||
    product.foldedWidth !== null ||
    product.foldedHeight !== null ||
    product.foldedDepth !== null;

  if (!hasSpecs && !hasDimensions) return null;

  return (
    <div id="specifications" className="scroll-mt-28 rounded-lg border border-border bg-card p-6">
      <h2 className="mb-4 text-2xl font-semibold text-ink">Specifications</h2>
      <div className="flex flex-col gap-5">
        {hasDimensions && <DimensionRows product={product} />}
        {materials !== "" && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Materials
            </p>
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-secondary">
              {materials}
            </p>
          </div>
        )}
        {features.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Features
            </p>
            <ul className="flex flex-col gap-1.5">
              {features.map((feature, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-ink-secondary">
                  <span aria-hidden className="mt-0.5 font-semibold text-cta">✓</span>
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

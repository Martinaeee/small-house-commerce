// src/components/product/ProductSpecs.tsx
import type { ReactNode } from "react";
import { DimensionRows, type SpecDimensions } from "./SizeGuide";
import { pdpSpecsVisible } from "./pdp-facts";

/** Narrow spec source so the admin live preview can pass a plain object. */
export interface ProductSpecSource extends SpecDimensions {
  materials?: string | null;
  features?: string | null;
}

function featureLines(features: string | null | undefined): string[] {
  return (features ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasDimensions(product: SpecDimensions): boolean {
  return (
    product.width !== null ||
    product.height !== null ||
    product.depth !== null ||
    product.foldedWidth !== null ||
    product.foldedHeight !== null ||
    product.foldedDepth !== null
  );
}

export function ProductSpecs({
  product,
  productWeight = null,
  includeFeatures = true,
}: {
  product: ProductSpecSource;
  productWeight?: number | null;
  /** Admin live preview compatibility; the real PDP moves features above media. */
  includeFeatures?: boolean;
}): ReactNode {
  const materials = product.materials?.trim() ?? "";
  const features = includeFeatures ? featureLines(product.features) : [];
  const dimensions = hasDimensions(product);

  // The PDP passes includeFeatures={false}, so this is exactly the predicate
  // the sticky nav uses — one rule, no drift between link and anchor.
  if (!pdpSpecsVisible(product, productWeight) && features.length === 0) {
    return null;
  }

  return (
    <section
      id="specifications"
      aria-labelledby="product-specifications-title"
      className="scroll-mt-28 rounded-lg border border-border bg-card p-6"
    >
      <h2
        id="product-specifications-title"
        className="mb-4 text-2xl font-semibold text-ink"
      >
        Product Specifications
      </h2>
      <div className="flex flex-col gap-5">
        {dimensions ? <DimensionRows product={product} /> : null}
        {materials !== "" ? (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Materials
            </p>
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-secondary">
              {materials}
            </p>
          </div>
        ) : null}
        {productWeight !== null ? (
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
            <p className="text-sm text-ink-secondary">Product weight</p>
            <p className="text-sm font-medium text-ink">{productWeight} kg</p>
          </div>
        ) : null}
        {features.length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Features
            </p>
            <ul className="flex flex-col gap-1.5">
              {features.map((feature, index) => (
                <li
                  key={`${feature}-${index}`}
                  className="flex items-start gap-2 text-sm text-ink-secondary"
                >
                  <span aria-hidden className="mt-0.5 font-semibold text-cta">
                    ✓
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function MaterialDimensions({
  product,
}: {
  product: ProductSpecSource;
}): ReactNode {
  const materials = product.materials?.trim() ?? "";
  const dimensions = hasDimensions(product);
  if (materials === "" && !dimensions) return null;

  return (
    <section
      aria-labelledby="material-dimensions-title"
      className="rounded-lg border border-border bg-card p-6"
    >
      <h2
        id="material-dimensions-title"
        className="mb-4 text-2xl font-semibold text-ink"
      >
        Material &amp; Dimensions
      </h2>
      <div className="grid gap-6 lg:grid-cols-2">
        {materials !== "" ? (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Material
            </p>
            <p className="whitespace-pre-line text-sm leading-relaxed text-ink-secondary">
              {materials}
            </p>
          </div>
        ) : null}
        {dimensions ? <DimensionRows product={product} /> : null}
      </div>
    </section>
  );
}

// src/components/product/ProductSpecs.tsx
import type { ReactNode } from "react";
import { visibleFeatureLines } from "@/lib/feature-lines";
import { DimensionRows, type SpecDimensions } from "./SizeGuide";
import { pdpSpecsVisible, resolveSkuProductDimensions, type ResolvedPdpSpecifications, type SkuProductDimensions } from "./pdp-facts";
import { BundleComponentSpecifications } from "./BundleComponentSpecifications";

/** Narrow spec source so the admin live preview can pass a plain object. */
export interface ProductSpecSource extends SpecDimensions {
  materials?: string | null;
  features?: string | null;
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
  product: sourceProduct,
  variantDimensions = null,
  productWeight: sourceWeight = null,
  includeFeatures = true,
  specifications,
}: {
  product: ProductSpecSource;
  variantDimensions?: SkuProductDimensions | null;
  productWeight?: number | null;
  specifications?: ResolvedPdpSpecifications;
  /** Admin live preview compatibility; the real PDP moves features above media. */
  includeFeatures?: boolean;
}): ReactNode {
  const bundle = specifications?.kind === "BUNDLE_COMPONENTS" ? specifications : null;
  const product = specifications?.kind === "SKU" ? specifications.product : { ...sourceProduct, ...resolveSkuProductDimensions(sourceProduct, variantDimensions) };
  const productWeight = bundle ? null : specifications?.kind === "SKU" ? specifications.productWeight : sourceWeight;
  const materials = bundle ? "" : product.materials?.trim() ?? "";
  const features = includeFeatures
    ? visibleFeatureLines(bundle ? bundle.features : product.features)
    : [];
  const dimensions = !bundle && hasDimensions(product);

  // The PDP passes includeFeatures={false}, so this is exactly the predicate
  // the sticky nav uses — one rule, no drift between link and anchor.
  if (!pdpSpecsVisible(product, productWeight, specifications) && features.length === 0) {
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
        {bundle ? <BundleComponentSpecifications components={bundle.components} /> : null}
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
  product: sourceProduct,
  variantDimensions = null,
  specifications,
}: {
  product: ProductSpecSource;
  variantDimensions?: SkuProductDimensions | null;
  specifications?: ResolvedPdpSpecifications;
}): ReactNode {
  const bundle = specifications?.kind === "BUNDLE_COMPONENTS" ? specifications : null;
  const product = specifications?.kind === "SKU" ? specifications.product : { ...sourceProduct, ...resolveSkuProductDimensions(sourceProduct, variantDimensions) };
  const materials = bundle ? "" : product.materials?.trim() ?? "";
  const dimensions = !bundle && hasDimensions(product);
  if (materials === "" && !dimensions && !bundle?.components.length) return null;

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
      <div className={bundle ? "" : "grid gap-6 lg:grid-cols-2"}>
        {bundle ? <BundleComponentSpecifications components={bundle.components} /> : null}
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

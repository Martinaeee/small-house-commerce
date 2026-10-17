import type { ReactNode } from "react";
import { DimensionRows } from "./SizeGuide";
import { BundleComponentSpecifications } from "./BundleComponentSpecifications";
import {
  hasPdpSpecificationDimensions,
  pdpSpecsVisible,
  type ResolvedPdpSpecifications,
} from "./pdp-facts";

/**
 * The resolved specifications always carry the real source, so this empty
 * stand-in only satisfies the shared visibility predicate's fallback branch.
 */
const EMPTY_SOURCE = {
  width: null,
  height: null,
  depth: null,
  foldedWidth: null,
  foldedHeight: null,
  foldedDepth: null,
  materials: null,
};

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5 shrink-0 text-ink-muted transition-transform group-open:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group border-b border-border px-5 last:border-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {title}
        <Chevron />
      </summary>
      <div className="pb-5 text-sm leading-relaxed text-ink-secondary">
        {children}
      </div>
    </details>
  );
}

/**
 * The single specification block on the PDP: dimensions, materials and weight
 * merged into one Amazon-style disclosure list instead of two cards that
 * repeated the same material and measurement values.
 */
export function ProductInformation({
  specifications,
}: {
  specifications: ResolvedPdpSpecifications;
}): ReactNode {
  // The same predicate the sticky nav uses, so a visible link always has an
  // anchor and an empty Bundle never falls back to the parent product's sizes.
  if (!pdpSpecsVisible(EMPTY_SOURCE, null, specifications)) return null;

  const materials =
    specifications.kind === "SKU"
      ? specifications.product.materials?.trim() ?? ""
      : "";

  return (
    <section
      id="specifications"
      aria-labelledby="product-information-title"
      className="scroll-mt-28 overflow-hidden rounded-lg border border-border bg-card"
    >
      <h2
        id="product-information-title"
        className="border-b border-border px-5 py-4 text-2xl font-semibold text-ink"
      >
        Product information
      </h2>
      {specifications.kind === "BUNDLE_COMPONENTS" ? (
        <Row title="Component specifications">
          <BundleComponentSpecifications
            components={specifications.components}
          />
        </Row>
      ) : (
        <>
          {hasPdpSpecificationDimensions(specifications) ? (
            <Row title="Measurements">
              <DimensionRows product={specifications.product} />
            </Row>
          ) : null}
          {materials !== "" ? (
            <Row title="Materials">
              <p className="whitespace-pre-line">{materials}</p>
            </Row>
          ) : null}
          {specifications.productWeight !== null ? (
            <Row title="Product weight">
              <p className="font-medium text-ink">
                {specifications.productWeight} kg
              </p>
            </Row>
          ) : null}
        </>
      )}
    </section>
  );
}

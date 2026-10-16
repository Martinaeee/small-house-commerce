import type { BundleComponentSpecification } from "@/lib/api";
import { DimensionRows } from "./SizeGuide";
import { hasPdpSpecificationDimensions } from "./pdp-facts";

export function BundleComponentSpecifications({ components }: { components: BundleComponentSpecification[] }) {
  if (components.length === 0) return <p className="text-sm text-ink-muted">Component specifications not available</p>;
  return <ul className="flex min-w-0 flex-col gap-5">
    {components.map((component, index) => <li key={`${component.productName}:${component.variantName}:${index}`} className="min-w-0 break-words rounded-lg border border-border p-4">
      <h3 className="font-semibold text-ink">{component.productName} <span>× {component.quantity}</span></h3>
      {component.variantName ? <p className="mt-1 text-sm text-ink-secondary">{component.variantName}</p> : null}
      <div className="mt-3">
        {hasPdpSpecificationDimensions({ kind: "BUNDLE_COMPONENTS", components: [component], features: null })
          ? <DimensionRows product={component} />
          : <p className="text-sm text-ink-muted">Dimensions not provided</p>}
      </div>
      {component.materials?.trim() ? <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Materials</p>
        <p className="whitespace-pre-line text-sm text-ink-secondary">{component.materials}</p>
      </div> : null}
      {component.productWeight !== null ? <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm">
        <span className="text-ink-secondary">Product weight</span><span className="font-medium text-ink">{component.productWeight} kg</span>
      </div> : null}
    </li>)}
  </ul>;
}

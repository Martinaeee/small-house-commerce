import type { Product } from "@/lib/api";
import { visibleFeatureLines } from "@/lib/feature-lines";

export function pdpHasVisibleHighlights(
  product: Pick<Product, "features" | "highlightsVisible">,
): boolean {
  return (
    product.highlightsVisible !== false &&
    visibleFeatureLines(product.features).length > 0
  );
}

/** Whether the PDP detail section has anything to show and earns its nav link. */
export function pdpHasDetails(
  product: Pick<
    Product,
    "description" | "features" | "highlightsVisible" | "detailBlocks"
  >,
): boolean {
  return (
    Boolean(product.description?.trim()) ||
    pdpHasVisibleHighlights(product) ||
    (product.detailBlocks ?? []).some((block) => block.url.trim() !== "")
  );
}

import type { Product } from "@/lib/api";
import { visibleFeatureLines } from "@/lib/feature-lines";

/** Whether the PDP detail section has anything to show and earns its nav link. */
export function pdpHasDetails(
  product: Pick<
    Product,
    "description" | "features" | "highlightsVisible" | "detailBlocks"
  >,
): boolean {
  const highlightsVisible =
    product.highlightsVisible !== false &&
    visibleFeatureLines(product.features).length > 0;
  return (
    Boolean(product.description?.trim()) ||
    highlightsVisible ||
    (product.detailBlocks ?? []).some((block) => block.url.trim() !== "")
  );
}

"use client";

import type { ReactNode } from "react";
import type { Product } from "@/lib/api";
import { usePdpPurchase } from "./PdpPurchaseProvider";
import { pdpSpecsVisible } from "./pdp-facts";
import { PdpSectionNav } from "./PdpSectionNav";

/**
 * Decides which section links are real for the CURRENT selection.
 *
 * Details is a product-level fact, but Specifications depends on the displayed
 * variant's weight, so it has to be read from the shared purchase state. The
 * predicate is the same one `ProductSpecs` uses, which is what keeps "link
 * visible" and "anchor rendered" from drifting apart when the variant changes.
 */
export function PdpSectionNavGate({
  product,
  hasDetails,
}: {
  product: Product;
  hasDetails: boolean;
}): ReactNode {
  const { primaryDerived } = usePdpPurchase();
  const hasSpecifications = pdpSpecsVisible(
    product,
    primaryDerived.displayVariant?.sku?.productWeight ?? null,
  );

  return (
    <PdpSectionNav
      hasDetails={hasDetails}
      hasSpecifications={hasSpecifications}
    />
  );
}

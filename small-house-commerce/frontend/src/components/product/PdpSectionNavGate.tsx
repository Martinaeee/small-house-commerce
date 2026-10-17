"use client";

import type { ReactNode } from "react";
import type { Product } from "@/lib/api";
import { pdpInformationVisible } from "./pdp-specification-display";
import { PdpSectionNav } from "./PdpSectionNav";
import { hasFaqContent } from "./ProductFaqSection";

export function PdpSectionNavGate({
  product,
  hasDetails,
}: {
  product: Product;
  hasDetails: boolean;
}): ReactNode {
  return (
    <PdpSectionNav
      hasDetails={hasDetails}
      hasSpecifications={pdpInformationVisible(product)}
      hasFaq={hasFaqContent(product.effectiveFaq ?? [])}
    />
  );
}

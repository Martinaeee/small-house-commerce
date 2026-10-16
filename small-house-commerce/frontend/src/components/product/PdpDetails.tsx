"use client";

import type { ReactNode } from "react";
import type { Product } from "@/lib/api";
import { PdpInfoSections } from "./PdpInfoSections";
import {
  ProductDetailBody,
  ProductDetailMedia,
} from "./ProductDetailBody";
import { MaterialDimensions, ProductSpecs } from "./ProductSpecs";
import { usePdpPurchase } from "./PdpPurchaseProvider";
import { partitionDetailBlocks } from "./pdp-detail-blocks";
import { resolveSelectedPdpSpecifications } from "./pdp-facts";

export function PdpDetails({
  product,
  supportEmail,
  supportHours,
}: {
  product: Product;
  supportEmail: string;
  supportHours: string;
}): ReactNode {
  const { primaryDerived } = usePdpPurchase();
  const { featured, remaining } = partitionDetailBlocks(
    product.detailBlocks ?? [],
  );
  const specifications = resolveSelectedPdpSpecifications(product, primaryDerived.displayVariant?.sku);

  return (
    <div className="flex flex-col gap-8">
      <ProductDetailBody
        description={product.description}
        features={product.features}
        featured={featured}
      />
      <ProductSpecs
        product={product}
        specifications={specifications}
        includeFeatures={false}
      />
      <ProductDetailMedia blocks={remaining} />
      <MaterialDimensions product={product} specifications={specifications} />
      <PdpInfoSections
        items={product.effectiveFaq ?? []}
        supportEmail={supportEmail}
        supportHours={supportHours}
      />
    </div>
  );
}

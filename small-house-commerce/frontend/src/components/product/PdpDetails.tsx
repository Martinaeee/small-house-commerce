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
  const productWeight =
    primaryDerived.displayVariant?.sku?.productWeight ?? null;

  return (
    <div className="flex flex-col gap-8">
      <ProductDetailBody
        description={product.description}
        features={product.features}
        featured={featured}
      />
      <ProductSpecs
        product={product}
        productWeight={productWeight}
        includeFeatures={false}
      />
      <ProductDetailMedia blocks={remaining} />
      <MaterialDimensions product={product} />
      <PdpInfoSections
        supportEmail={supportEmail}
        supportHours={supportHours}
      />
    </div>
  );
}

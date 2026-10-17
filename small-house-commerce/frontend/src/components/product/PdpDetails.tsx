"use client";

import type { ReactNode } from "react";
import type { Product } from "@/lib/api";
import { PdpInfoSections } from "./PdpInfoSections";
import {
  ProductDetailBody,
  ProductDetailMedia,
} from "./ProductDetailBody";
import { ProductInformation } from "./ProductInformation";
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
  const { featured, remaining } = partitionDetailBlocks(
    product.detailBlocks ?? [],
  );

  return (
    <div className="flex flex-col gap-8">
      <ProductDetailBody
        description={product.description}
        features={product.features}
        featured={featured}
      />
      <ProductDetailMedia blocks={remaining} />
      <ProductInformation product={product} />
      <PdpInfoSections
        items={product.effectiveFaq ?? []}
        supportEmail={supportEmail}
        supportHours={supportHours}
      />
    </div>
  );
}

"use client";

import { useState, type ReactNode } from "react";
import type { Product } from "@/lib/api";
import {
  ProductDetailBody,
  ProductDetailMedia,
} from "./ProductDetailBody";
import { ProductInformation } from "./ProductInformation";
import {
  partitionDetailBlocks,
  type DetailBlockLike,
} from "./pdp-detail-blocks";

/** How many detail media the page shows before the shopper asks for more. */
const DETAIL_PREVIEW_LIMIT = 4;

/**
 * The long detail media fold. The featured block is rendered by
 * ProductDetailBody already, so this count continues from the fifth entry
 * overall; the button stays hidden when everything already fits.
 */
function FoldableDetailMedia({
  blocks,
}: {
  blocks: readonly DetailBlockLike[];
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  if (blocks.length === 0) return null;

  const collapsedCount = Math.max(0, DETAIL_PREVIEW_LIMIT - 1);
  const hiddenCount = Math.max(0, blocks.length - collapsedCount);
  const visible = expanded ? blocks : blocks.slice(0, collapsedCount);

  return (
    <div className="flex flex-col gap-4">
      <ProductDetailMedia blocks={visible} />
      {hiddenCount > 0 ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="mx-auto rounded-lg border border-border bg-card px-6 py-2.5 text-sm font-semibold text-cta transition hover:border-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
        >
          {expanded ? "Show less" : `See more (${hiddenCount})`}
        </button>
      ) : null}
    </div>
  );
}

export function PdpDetails({
  product,
}: {
  product: Product;
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
      <FoldableDetailMedia blocks={remaining} />
      <ProductInformation product={product} />
    </div>
  );
}

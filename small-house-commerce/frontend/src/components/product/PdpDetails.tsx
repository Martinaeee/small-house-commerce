"use client";

import { useState, type ReactNode } from "react";
import type { Product } from "@/lib/api";
import {
  ProductDetailBody,
  ProductDetailMedia,
} from "./ProductDetailBody";
import { ProductInformation } from "./ProductInformation";
import { usePdpPurchase } from "./PdpPurchaseProvider";
import {
  partitionDetailBlocks,
  resolveDetailBlocksForSelection,
  type DetailBlockLike,
} from "./pdp-detail-blocks";

/** How many detail media the page shows before the shopper asks for more. */
const DETAIL_PREVIEW_LIMIT = 4;

/**
 * The long detail media fold. Every detail image is stitched directly to the
 * next one; on phones each frame runs edge to edge. The first
 * DETAIL_PREVIEW_LIMIT blocks (featured included) show before the shopper
 * asks for more.
 */
function FoldableDetailMedia({
  featured,
  blocks,
}: {
  featured: DetailBlockLike | null;
  blocks: readonly DetailBlockLike[];
}): ReactNode {
  const [expanded, setExpanded] = useState(false);
  const all = featured ? [featured, ...blocks] : [...blocks];
  if (all.length === 0) return null;

  const visible = expanded ? all : all.slice(0, DETAIL_PREVIEW_LIMIT);
  const canToggle = all.length > DETAIL_PREVIEW_LIMIT;
  const hiddenCount = all.length - DETAIL_PREVIEW_LIMIT;

  return (
    <div className="flex flex-col">
      <ProductDetailMedia blocks={visible} fullBleed />
      {canToggle ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="mx-auto mt-4 rounded-lg border border-border bg-card px-6 py-2.5 text-sm font-semibold text-cta transition hover:border-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
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
  const { product: purchaseProduct, primaryLine, primaryDerived } =
    usePdpPurchase();
  const scopedBlocks = resolveDetailBlocksForSelection(
    product.detailBlocks ?? [],
    purchaseProduct.options,
    primaryLine.selectedValueIds,
    primaryDerived.resolvedVariant?.id ?? null,
  );
  const { featured, remaining } = partitionDetailBlocks(scopedBlocks);

  return (
    <div className="flex flex-col gap-8">
      <ProductDetailBody
        description={product.description}
        features={product.features}
      />
      <FoldableDetailMedia featured={featured} blocks={remaining} />
      <ProductInformation product={product} />
    </div>
  );
}

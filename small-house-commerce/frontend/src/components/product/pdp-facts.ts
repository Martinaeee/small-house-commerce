import type { Product } from "@/lib/api";

export type PdpDimensionSource = Pick<
  Product,
  | "width"
  | "height"
  | "depth"
  | "foldedWidth"
  | "foldedHeight"
  | "foldedDepth"
>;

export interface PdpDimensionSummary {
  assembled: string | null;
  folded: string | null;
}

function dimensionSet(
  width: number | null,
  height: number | null,
  depth: number | null,
): string | null {
  if (width === null && height === null && depth === null) return null;
  return `${width ?? "—"} × ${height ?? "—"} × ${depth ?? "—"} cm`;
}

export function pdpDimensionSummary(
  product: PdpDimensionSource,
): PdpDimensionSummary {
  return {
    assembled: dimensionSet(product.width, product.height, product.depth),
    folded: dimensionSet(
      product.foldedWidth,
      product.foldedHeight,
      product.foldedDepth,
    ),
  };
}

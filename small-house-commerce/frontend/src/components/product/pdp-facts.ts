import type { Product, Solution } from "@/lib/api";

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

/** One selling-point pill under the tagline. */export interface PdpSellingPoint {
  value: Solution;
  label: string;
}

/**
 * Label for every solution the admin can tag (the 卖点标签 checkboxes in the
 * product editor). The list is fixed here rather than free text so a pill can
 * never drift from the tag it represents; the matching line icon lives in
 * `pdp-solution-icons.tsx`.
 */
const SOLUTION_BADGES: readonly PdpSellingPoint[] = [
  { value: "FOLDABLE", label: "Foldable" },
  { value: "NARROW_SPACE", label: "Narrow Space" },
  { value: "MOBILE", label: "Easy to Move" },
  { value: "MULTIFUNCTIONAL", label: "Multifunctional" },
  { value: "HIDDEN_STORAGE", label: "Hidden Storage" },
  { value: "RENTAL_FRIENDLY", label: "Rental Friendly" },
];

/**
 * Selling points for the hero, filtered to the product's real tags and kept
 * in canonical order so the row does not reshuffle between saves.
 */
export function pdpSolutionBadges(
  product: Pick<Product, "solutions">,
): PdpSellingPoint[] {
  const tagged = new Set(product.solutions);
  return SOLUTION_BADGES.filter((badge) => tagged.has(badge.value));
}

export type PdpSpecSource = Pick<
  Product,
  | "materials"
  | "width"
  | "height"
  | "depth"
  | "foldedWidth"
  | "foldedHeight"
  | "foldedDepth"
>;

/**
 * Whether the Specifications section renders — the ONE rule behind both the
 * section itself and its sticky-nav link. `productWeight` belongs to the
 * currently displayed variant, so the answer changes with the selection; the
 * nav reads it from the same purchase state rather than scanning every
 * variant (which used to leave a link pointing at a section that never
 * rendered).
 */
export function pdpSpecsVisible(
  product: PdpSpecSource,
  productWeight: number | null,
): boolean {
  return (
    Boolean(product.materials?.trim()) ||
    product.width !== null ||
    product.height !== null ||
    product.depth !== null ||
    product.foldedWidth !== null ||
    product.foldedHeight !== null ||
    product.foldedDepth !== null ||
    productWeight !== null
  );
}

import { validateBundleDefinition, type BundleDefinitionComponent } from '../inventory/bundle-inventory.js';

export interface BundleComponentSpecification {
  productName: string;
  variantName: string;
  quantity: number;
  width: number | null;
  depth: number | null;
  height: number | null;
  foldedWidth: number | null;
  foldedDepth: number | null;
  foldedHeight: number | null;
  productWeight: number | null;
  materials: string | null;
}

export interface BundleComponentSpecificationRow extends BundleDefinitionComponent {
  productName: string;
  variantName: string;
  skuDimensions: { width: number | null; depth: number | null; height: number | null };
  productDimensions: { width: number | null; depth: number | null; height: number | null };
  foldedWidth: number | null;
  foldedDepth: number | null;
  foldedHeight: number | null;
  productWeight: number | null;
  materials: string | null;
}

export function projectBundleComponentSpecifications(rows: readonly BundleComponentSpecificationRow[]): BundleComponentSpecification[] {
  if (validateBundleDefinition(rows) !== null) return [];
  return rows.map(row => ({
    productName: row.productName,
    variantName: row.variantName,
    quantity: row.quantity,
    width: row.skuDimensions.width ?? row.productDimensions.width,
    depth: row.skuDimensions.depth ?? row.productDimensions.depth,
    height: row.skuDimensions.height ?? row.productDimensions.height,
    foldedWidth: row.foldedWidth,
    foldedDepth: row.foldedDepth,
    foldedHeight: row.foldedHeight,
    productWeight: row.productWeight,
    materials: row.materials,
  }));
}

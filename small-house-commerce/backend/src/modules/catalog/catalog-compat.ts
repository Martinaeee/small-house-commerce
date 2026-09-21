import { createHash } from 'node:crypto';
import { canonicalCombinationKey } from './catalog-graph.js';

export const LEGACY_STYLE_OPTION_NAMESPACE =
  'small-house/catalog/legacy-style-option/v1';
export const LEGACY_STYLE_VALUE_NAMESPACE =
  'small-house/catalog/legacy-style-value/v1';

export type CatalogSkuStatus = 'ACTIVE' | 'DISABLED';
export type CatalogOptionKind = 'COLOR' | 'SIZE' | 'MATERIAL' | 'STYLE';
export type CatalogOptionPresentation = 'IMAGE' | 'SWATCH' | 'TEXT';
export type CatalogMediaType = 'IMAGE' | 'VIDEO';

export interface CatalogMediaRow {
  id: string;
  url: string;
  type: CatalogMediaType;
  altText: string | null;
  sortOrder: number;
  optionValueId: string | null;
  variantId: string | null;
}

export interface CatalogSkuRow {
  id: string;
  skuCode: string;
  status: CatalogSkuStatus;
  price: unknown | null;
  compareAtPrice: unknown | null;
  availableInventory?: number;
  productWeight?: number | null;
  packageWidth?: number | null;
  packageHeight?: number | null;
  packageDepth?: number | null;
  packageWeight?: number | null;
}

export interface CatalogOptionValueRow {
  id: string;
  label: string;
  position: number;
  swatchHex: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  isActive: boolean;
}

export interface CatalogOptionRow {
  id: string;
  kind: CatalogOptionKind;
  name: string;
  position: number;
  presentation: CatalogOptionPresentation;
  isMediaDriver: boolean;
  isActive: boolean;
  values: readonly CatalogOptionValueRow[];
}

export interface CatalogVariantOptionValueRow {
  optionId: string;
  optionValueId: string;
}

export interface CatalogVariantRow {
  id: string;
  name: string;
  position: number;
  combinationKey: string | null;
  optionValues: readonly CatalogVariantOptionValueRow[];
  sku: CatalogSkuRow | null;
}

export interface CatalogProductRow {
  id: string;
  catalogGraphVersion: number;
  defaultDisplayVariantId: string | null;
  images: readonly CatalogMediaRow[];
  options: readonly CatalogOptionRow[];
  variants: readonly CatalogVariantRow[];
}

export interface PresentedCatalogOptionValue {
  id: string;
  label: string;
  position: number;
  swatchHex: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
}

export interface PresentedCatalogOption {
  id: string;
  kind: CatalogOptionKind;
  name: string;
  position: number;
  presentation: CatalogOptionPresentation;
  isMediaDriver: boolean;
  values: PresentedCatalogOptionValue[];
}

export interface PresentedCatalogVariant {
  id: string;
  name: string;
  position: number;
  combinationKey: string;
  optionValueIds: string[];
  sku: CatalogSkuRow | null;
}

export interface PresentedCatalogGraph {
  catalogGraphVersion: number;
  options: PresentedCatalogOption[];
  variants: PresentedCatalogVariant[];
  defaultDisplayVariantId: string | null;
  effectiveCoverMedia: CatalogMediaRow | null;
  images: CatalogMediaRow[];
}

/**
 * Mirrors PostgreSQL `md5(namespace || ':' || source_id::text)::uuid`.
 * MD5 is used only for deterministic identity, not for security.
 */
function namespacedMd5Uuid(namespace: string, sourceId: string): string {
  const hex = createHash('md5')
    .update(`${namespace}:${sourceId}`, 'utf8')
    .digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function comparePositionThenId<T extends { id: string; position: number }>(
  left: T,
  right: T,
): number {
  return left.position - right.position || compareId(left.id, right.id);
}

function compareSortOrderThenId<T extends { id: string; sortOrder: number }>(
  left: T,
  right: T,
): number {
  return left.sortOrder - right.sortOrder || compareId(left.id, right.id);
}

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function projectLegacyImages<
  T extends {
    id: string;
    sortOrder: number;
    optionValueId: string | null;
    variantId: string | null;
  },
>(product: { images: readonly T[] }): T[] {
  return product.images
    .filter((image) => image.optionValueId === null && image.variantId === null)
    .sort(compareSortOrderThenId);
}

export function projectLegacyCatalogGraph(
  product: CatalogProductRow,
): PresentedCatalogGraph {
  const optionId = namespacedMd5Uuid(LEGACY_STYLE_OPTION_NAMESPACE, product.id);
  const orderedVariants = [...product.variants].sort(comparePositionThenId);
  const valueIdByVariantId = new Map(
    orderedVariants.map((variant) => [
      variant.id,
      namespacedMd5Uuid(LEGACY_STYLE_VALUE_NAMESPACE, variant.id),
    ]),
  );
  const images = projectLegacyImages(product);

  const variants = orderedVariants.map((variant) => {
    const valueId = valueIdByVariantId.get(variant.id)!;
    return {
      id: variant.id,
      name: variant.name,
      position: variant.position,
      combinationKey: canonicalCombinationKey([{ optionId, valueId }]),
      optionValueIds: [valueId],
      sku: variant.sku,
    };
  });

  const defaultDisplayVariantId =
    orderedVariants.find(
      (variant) =>
        variant.sku?.status === 'ACTIVE' && variant.sku.price != null,
    )?.id ?? null;

  return {
    catalogGraphVersion: product.catalogGraphVersion,
    options: [
      {
        id: optionId,
        kind: 'STYLE',
        name: 'Style',
        position: 0,
        presentation: 'TEXT',
        isMediaDriver: false,
        values: orderedVariants.map((variant) => ({
          id: valueIdByVariantId.get(variant.id)!,
          label: variant.name,
          position: variant.position,
          swatchHex: null,
          thumbnailUrl: null,
          thumbnailAlt: null,
        })),
      },
    ],
    variants,
    defaultDisplayVariantId,
    effectiveCoverMedia: images[0] ?? null,
    images,
  };
}

export function presentPersistedCatalogGraph(
  product: CatalogProductRow,
): PresentedCatalogGraph {
  const images = projectLegacyImages(product);
  const activeOptions = product.options
    .filter((option) => option.isActive)
    .sort((left, right) => left.position - right.position);
  const optionPosition = new Map(
    activeOptions.map((option) => [option.id, option.position]),
  );

  return {
    catalogGraphVersion: product.catalogGraphVersion,
    options: activeOptions.map((option) => ({
      id: option.id,
      kind: option.kind,
      name: option.name,
      position: option.position,
      presentation: option.presentation,
      isMediaDriver: option.isMediaDriver,
      values: option.values
        .filter((value) => value.isActive)
        .sort((left, right) => left.position - right.position)
        .map((value) => ({
          id: value.id,
          label: value.label,
          position: value.position,
          swatchHex: value.swatchHex,
          thumbnailUrl: value.thumbnailUrl,
          thumbnailAlt: value.thumbnailAlt,
        })),
    })),
    variants: product.variants.map((variant) => {
      const assignments = [...variant.optionValues].sort(
        (left, right) =>
          (optionPosition.get(left.optionId) ?? Number.MAX_SAFE_INTEGER) -
            (optionPosition.get(right.optionId) ?? Number.MAX_SAFE_INTEGER) ||
          left.optionId.localeCompare(right.optionId),
      );
      return {
        id: variant.id,
        name: variant.name,
        position: variant.position,
        combinationKey:
          variant.combinationKey ??
          canonicalCombinationKey(
            assignments.map((assignment) => ({
              optionId: assignment.optionId,
              valueId: assignment.optionValueId,
            })),
          ),
        optionValueIds: assignments.map(
          (assignment) => assignment.optionValueId,
        ),
        sku: variant.sku,
      };
    }),
    defaultDisplayVariantId: product.defaultDisplayVariantId,
    effectiveCoverMedia: images[0] ?? null,
    images,
  };
}

export function presentCatalogGraph(
  product: CatalogProductRow,
): PresentedCatalogGraph {
  return product.catalogGraphVersion === 0
    ? projectLegacyCatalogGraph(product)
    : presentPersistedCatalogGraph(product);
}

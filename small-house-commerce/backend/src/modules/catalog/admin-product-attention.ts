import { Prisma } from '../../generated/prisma/client.js';

/**
 * The Products-list "Needs attention" presets.
 *
 * Each preset is a narrow, named check the operator can click. One predicate
 * backs both the global count and the list filter, so a chip can never
 * disagree with the rows it reveals.
 */
export const ATTENTION_FILTERS = [
  'missing_media',
  'no_priced_sku',
  'incomplete_shipping',
  'stale_draft',
] as const;

export type AttentionFilter = (typeof ATTENTION_FILTERS)[number];

/** A draft untouched for this long counts as stale. */
export const STALE_DRAFT_DAYS = 30;

export function staleDraftBefore(now: Date = new Date()): Date {
  return new Date(now.getTime() - STALE_DRAFT_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * The shipping fields a sellable SKU needs before fulfillment can quote it.
 * A product is "incomplete" while any of its SKUs is missing one of them.
 */
const SHIPPING_FIELDS = [
  'productWeight',
  'packageWidth',
  'packageHeight',
  'packageDepth',
  'packageWeight',
] as const;

export function attentionWhere(
  filter: AttentionFilter,
  now: Date = new Date(),
): Prisma.ProductWhereInput {
  switch (filter) {
    case 'missing_media':
      // The shared gallery is the fallback every storefront surface can use;
      // scoped rows alone do not give the product a usable cover.
      return { images: { none: { optionValueId: null, variantId: null } } };
    case 'no_priced_sku':
      return {
        status: 'ACTIVE',
        skus: { none: { status: 'ACTIVE', price: { not: null } } },
      };
    case 'incomplete_shipping':
      return {
        skus: {
          some: {
            OR: SHIPPING_FIELDS.map((field) => ({ [field]: null })),
          },
        },
      };
    case 'stale_draft':
      return { status: 'DRAFT', updatedAt: { lt: staleDraftBefore(now) } };
  }
}

export interface AdminProductCounts {
  status: { all: number; active: number; draft: number; disabled: number };
  attention: Record<AttentionFilter, number>;
}

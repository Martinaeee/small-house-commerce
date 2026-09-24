import { describe, expect, it } from 'vitest';
import {
  STALE_DRAFT_DAYS,
  attentionWhere,
  staleDraftBefore,
} from './admin-product-attention.js';

/**
 * One predicate per "needs attention" preset. The same function backs the
 * global count and the list filter, so these assertions pin what both mean.
 */
describe('attentionWhere', () => {
  it('flags products with no shared gallery media', () => {
    expect(attentionWhere('missing_media')).toEqual({
      images: { none: { optionValueId: null, variantId: null } },
    });
  });

  it('flags ACTIVE products whose SKUs carry no active price', () => {
    expect(attentionWhere('no_priced_sku')).toEqual({
      status: 'ACTIVE',
      skus: { none: { status: 'ACTIVE', price: { not: null } } },
    });
  });

  it('flags products whose SKUs are missing shipping fields', () => {
    expect(attentionWhere('incomplete_shipping')).toEqual({
      skus: {
        some: {
          OR: [
            { productWeight: null },
            { packageWidth: null },
            { packageHeight: null },
            { packageDepth: null },
            { packageWeight: null },
          ],
        },
      },
    });
  });

  it('flags drafts untouched for the stale window, measured from the given clock', () => {
    const now = new Date('2026-09-24T00:00:00.000Z');

    expect(attentionWhere('stale_draft', now)).toEqual({
      status: 'DRAFT',
      updatedAt: { lt: new Date('2026-08-25T00:00:00.000Z') },
    });
    expect(STALE_DRAFT_DAYS).toBe(30);
    expect(staleDraftBefore(now).toISOString()).toBe('2026-08-25T00:00:00.000Z');
  });
});
